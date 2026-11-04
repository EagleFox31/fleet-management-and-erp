import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { lockoutConfigFromEnv } from "../../server/services/login-lockout-service";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Compteur anti-force brute sous requêtes simultanées : la tentative est réservée en base avant le
 * travail coûteux (bcrypt). Une rafale ne doit jamais obtenir plus de MAX vérifications.
 */

const MAX = lockoutConfigFromEnv().maxAttempts;
const BURST = 20;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const keys: string[] = [];
const savedIpMax = process.env.AUTH_IP_FAILURE_MAX;

async function post(path: string, body: unknown, forwardedFor?: string, cookie?: string) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as any,
    retryAfter: res.headers.get("retry-after"),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}

const tally = (statuses: number[]) => statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => {
  if (savedIpMax === undefined) delete process.env.AUTH_IP_FAILURE_MAX;
  else process.env.AUTH_IP_FAILURE_MAX = savedIpMax;
});

afterAll(async () => {
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("verrouillage : rafale de requêtes simultanées", { timeout: 120000 }, () => {
  it(`PIN : ${BURST} PIN faux en parallèle sur un même compte, au plus ${MAX} vérifiés, les autres 429`, async () => {
    const created = await createTestUser({ role: "driver" });
    ids.userIds.push(created.id);
    await db.update(users).set({ pin: await bcrypt.hash("4821", 4) }).where(eq(users.id, created.id));
    keys.push(storedLockoutKey(`pin:${created.id}`));

    const results = await Promise.all(
      Array.from({ length: BURST }, (_, i) => post("/api/auth/pin-login", { userId: created.id, pin: String(1000 + i) })),
    );
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(MAX);
    expect((counts[401] ?? 0) + (counts[429] ?? 0), JSON.stringify(counts)).toBe(BURST);
    // Le bon PIN reste refusé : le compte est verrouillé.
    expect((await post("/api/auth/pin-login", { userId: created.id, pin: "4821" })).status).toBe(429);
  });

  it(`mot de passe : ${BURST} essais en parallèle sur un même nom, au plus ${MAX} vérifiés`, async () => {
    const created = await createTestUser({ role: "technician" });
    ids.userIds.push(created.id);
    keys.push(storedLockoutKey(created.username));
    const results = await Promise.all(
      Array.from({ length: BURST }, (_, i) => post("/api/auth/login", { username: created.username, password: `faux-${i}` })),
    );
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(MAX);
    expect((counts[401] ?? 0) + (counts[429] ?? 0), JSON.stringify(counts)).toBe(BURST);
    expect((await post("/api/auth/login", { username: created.username, password: TEST_USER_PASSWORD })).status).toBe(429);
  });

  it(`changement de mot de passe : ${BURST} mots de passe actuels faux en parallèle, au plus ${MAX} vérifiés`, async () => {
    const created = await createTestUser({ role: "technician" });
    ids.userIds.push(created.id);
    keys.push(storedLockoutKey(created.username), `${CHANGE_PASSWORD_KEY_PREFIX}${created.id}`);
    const session = await post("/api/auth/login", { username: created.username, password: TEST_USER_PASSWORD });
    expect(session.status).toBe(200);
    const change = (currentPassword: string) =>
      post("/api/users/change-password", { currentPassword, newPassword: "nouveau-mot-de-passe-1" }, undefined, session.cookie);
    const results = await Promise.all(Array.from({ length: BURST }, (_, i) => change(`faux-${i}`)));
    const counts = tally(results.map((r) => r.status));
    expect(counts[401] ?? 0, JSON.stringify(counts)).toBeLessThanOrEqual(MAX);
    expect((counts[401] ?? 0) + (counts[429] ?? 0), JSON.stringify(counts)).toBe(BURST);
    expect((await change(TEST_USER_PASSWORD)).status, "le bon mot de passe reste refusé").toBe(429);
  });

  it("limite par IP : succès intercalés sans effet, X-Forwarded-For forgé ignoré au-delà du premier saut", async () => {
    process.env.AUTH_IP_FAILURE_MAX = "3";
    // Adresse propre au test (dernier saut, celui que le proxy de confiance ajoute).
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const ok = await createTestUser({ role: "technician" });
    ids.userIds.push(ok.id);
    keys.push(storedLockoutKey(ok.username));
    const fail = (forged: string) => {
      const name = `ip-limit-probe-${Math.random().toString(36).slice(2)}`;
      keys.push(storedLockoutKey(name));
      // Entrée de gauche forgée, différente à chaque essai : elle ne doit pas changer l'adresse comptée.
      return post("/api/auth/login", { username: name, password: "faux" }, `${forged}, ${ip}`);
    };
    const succeed = () => post("/api/auth/login", { username: ok.username, password: TEST_USER_PASSWORD }, ip);

    // Échecs sur des noms tous différents (sous le seuil de chaque compte), succès intercalés.
    expect((await fail("10.0.0.1")).status).toBe(401);
    expect((await succeed()).status).toBe(200);
    expect((await fail("10.0.0.2")).status).toBe(401);
    expect((await succeed()).status).toBe(200);
    expect((await fail("10.0.0.3")).status).toBe(401);

    // Plafond atteint : un succès intercalé n'a rien libéré, même le bon mot de passe est refusé.
    const blocked = await succeed();
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(blocked.body)).not.toContain(ok.username);
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect((await fail("10.0.0.4")).status, "autre entrée forgée, même dernier saut").toBe(429);

    // Une autre adresse n'est pas touchée.
    expect((await post("/api/auth/login", { username: ok.username, password: TEST_USER_PASSWORD }, "198.51.100.250")).status).toBe(200);
  });
});
