import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { solveChallenge } from "altcha-lib/v1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, db } from "../../server/db";
import { activityLogs, partsStockMovements, users } from "../../shared/schema";
import { setAuditSink } from "../../server/lib/audit";
import { dbAuditSink } from "../../server/lib/audit-db-sink";
import { issueCaptchaChallenge } from "../../server/services/captcha-service";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Montage des gardes dans server/api/index.ts (T-57) :
 * - verrouillage sur /auth/login et /auth/pin-login : N echecs -> 429 RATE_LIMITED + lockedUntil ;
 * - captcha apres 3 echecs, preuve rejouee refusee ;
 * - une ecriture auditee laisse une ligne activity_logs.
 */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const usernames: string[] = [];
const MAX = Number(process.env.LOCKOUT_MAX_ATTEMPTS) || 5;
const settle = () => new Promise((r) => setTimeout(r, 150));

async function post(path: string, body: unknown, cookie?: string) {
  const r = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
}

async function proof(): Promise<string> {
  const c = await issueCaptchaChallenge();
  const s = await solveChallenge(c.challenge, c.salt, c.algorithm as "SHA-256", c.maxnumber).promise;
  return Buffer.from(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: s!.number, salt: c.salt, signature: c.signature })).toString("base64");
}

beforeAll(async () => {
  process.env.ALTCHA_HMAC_KEY ||= "contract-test-hmac-key";
  setAuditSink(dbAuditSink);
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  delete process.env.FEATURE_FLAGS;
  setAuditSink(null);
  const keys = [
    ...usernames.map((u) => `pwd:${u}`),
    ...ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`]),
  ];
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  if (ids.userIds.length) await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  if (ids.partIds.length) await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("gardes de connexion montes", { timeout: 120000 }, () => {
  it("/auth/login : N echecs puis 429 RATE_LIMITED avec lockedUntil, meme avec le bon mot de passe", async () => {
    const user = await createTestUser({ role: "technician" });
    ids.userIds.push(user.id);
    usernames.push(user.username.toLowerCase());
    for (let i = 0; i < MAX; i++) {
      expect((await post("/api/auth/login", { username: user.username, password: "mauvais" })).status).toBe(401);
      await settle();
    }
    const locked = await post("/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number.isNaN(Date.parse(locked.body.lockedUntil))).toBe(false);
  });

  it("/auth/pin-login : N echecs puis 429 RATE_LIMITED avec lockedUntil", async () => {
    const driver = await createTestUser({ role: "driver" });
    ids.userIds.push(driver.id);
    await db.update(users).set({ pin: await bcrypt.hash("1234", 4) }).where(eq(users.id, driver.id));
    for (let i = 0; i < MAX; i++) {
      expect((await post("/api/auth/pin-login", { userId: driver.id, pin: "0000" })).status).toBe(401);
      await settle();
    }
    const locked = await post("/api/auth/pin-login", { userId: driver.id, pin: "1234" });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number.isNaN(Date.parse(locked.body.lockedUntil))).toBe(false);
  });

  it("espaces de cles separes : 5 echecs login avec l'identifiant « <id> » ne bloquent pas le pin-login de l'utilisateur d'id <id>", async () => {
    const driver = await createTestUser({ role: "driver" });
    ids.userIds.push(driver.id);
    await db.update(users).set({ pin: await bcrypt.hash("1234", 4) }).where(eq(users.id, driver.id));
    for (let i = 0; i < MAX; i++) {
      expect((await post("/api/auth/login", { username: String(driver.id), password: "mauvais" })).status).toBe(401);
      await settle();
    }
    expect((await post("/api/auth/login", { username: String(driver.id), password: "mauvais" })).status).toBe(429);
    const pin = await post("/api/auth/pin-login", { userId: driver.id, pin: "1234" });
    expect(pin.status).toBe(200);
    await settle();
    const [row] = await db.select().from(users).where(eq(users.id, driver.id));
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("captcha : exige apres 3 echecs, preuve valide acceptee une fois, rejeu refuse", async () => {
    process.env.FEATURE_FLAGS = "captcha=on";
    const user = await createTestUser({ role: "technician" });
    ids.userIds.push(user.id);
    usernames.push(user.username.toLowerCase());
    for (let i = 0; i < 3; i++) {
      expect((await post("/api/auth/login", { username: user.username, password: "mauvais" })).status).toBe(401);
      await settle();
    }
    const without = await post("/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD });
    expect(without.status).toBe(400);
    expect(JSON.stringify(without.body)).toContain("captcha");

    const p = await proof();
    const first = await post("/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD, captcha: p });
    expect(first.status).toBe(200);
    await settle();

    // Meme preuve, apres de nouveaux echecs : refusee.
    for (let i = 0; i < 3; i++) {
      await post("/api/auth/login", { username: user.username, password: "mauvais", captcha: await proof() });
      await settle();
    }
    const replay = await post("/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD, captcha: p });
    expect(replay.status).toBe(400);
    expect(JSON.stringify(replay.body)).toContain("captcha");
  });

  it("une ecriture auditee laisse une ligne activity_logs", async () => {
    const admin = await createTestUser({ role: "warehouse" });
    ids.userIds.push(admin.id);
    const login = await post("/api/auth/login", { username: admin.username, password: TEST_USER_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const res = await post(`/api/parts/${part.id}/update-stock`, { adjustment: 1, reason: "audit contrat" }, cookie);
    expect(res.status).toBeLessThan(400);
    await settle();
    const rows = await db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.entityType, "part"), eq(activityLogs.entityId, part.id)))
      .orderBy(desc(activityLogs.id));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ action: "create", method: "POST" });
    await db.delete(activityLogs).where(and(eq(activityLogs.entityType, "part"), eq(activityLogs.entityId, part.id)));
  });
});
