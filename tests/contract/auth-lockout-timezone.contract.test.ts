import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCKED_USERS_PATH, LOCKOUT_DEFAULTS } from "../../shared/contracts/auth-lockout";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { DbLockoutStore } from "../../server/services/login-lockout-db-store";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Heure de fin de verrou, serveur hors UTC (Douala, UTC+1).
 *
 * `users.locked_until` est un `timestamp` sans fuseau écrit par `pg` en heure locale.
 * La liste le relisait par Drizzle, qui suppose de l'UTC : fin affichée +1 h et compte
 * gardé dans la liste une heure après son déverrouillage. En UTC (CI) le défaut est
 * invisible : le test fixe donc le fuseau du processus le temps du fichier.
 */
let server: Server;
let baseUrl = "";
let cookie = "";
let previousTz: string | undefined;
const ids = createIdBag();
const store = new DbLockoutStore();
let target = { id: 0, username: "" };
const cfg = { maxAttempts: LOCKOUT_DEFAULTS.maxAttempts, lockMinutes: LOCKOUT_DEFAULTS.lockMinutes };

beforeAll(async () => {
  previousTz = process.env.TZ;
  process.env.TZ = "Africa/Douala";
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
  const u = await createTestUser({ role: "technician" });
  ids.userIds.push(u.id);
  target = { id: u.id, username: u.username.trim().toLowerCase() };
}, 180000);

afterAll(async () => {
  await db.execute(sql`DELETE FROM login_attempts_by_username WHERE username_normalized = ${target.username}`);
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe("/api/admin/users/locked : heure de fin hors UTC", { timeout: 120000 }, () => {
  it("le processus est bien en UTC+1 (sinon le test ne prouverait rien)", () => {
    expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(-60);
  });

  it("renvoie l'instant exact de fin de verrou, et le compte sort de la liste à cet instant", async () => {
    const now = new Date();
    for (let i = 0; i < cfg.maxAttempts; i++) await store.registerFailure(target.username, now, cfg);
    const expected = now.getTime() + cfg.lockMinutes * 60_000;

    const res = await fetch(baseUrl + LOCKED_USERS_PATH, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const mine = ((await res.json()) as { id: number; lockedUntil: string; lastFailedLoginAt: string | null }[]).find(
      (u) => u.id === target.id,
    );
    expect(mine).toBeDefined();
    expect(Math.abs(Date.parse(mine!.lockedUntil) - expected)).toBeLessThan(1000);
    expect(Math.abs(Date.parse(mine!.lastFailedLoginAt!) - now.getTime())).toBeLessThan(1000);

    expect((await store.listLocked(new Date(expected - 1000))).some((u) => u.id === target.id)).toBe(true);
    expect((await store.listLocked(new Date(expected + 1000))).some((u) => u.id === target.id)).toBe(false);
  });
});
