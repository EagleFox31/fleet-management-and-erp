import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LOCKED_USERS_PATH,
  lockedUsersResponseSchema,
  LOCKOUT_DEFAULTS,
  unlockUserPath,
  unlockUserResponseSchema,
} from "../../shared/contracts/auth-lockout";
import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { DbLockoutStore } from "../../server/services/login-lockout-db-store";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { leakText } from "../support/api-error";

/** Niveau C, T-13 : liste des comptes verrouilles et deverrouillage admin. */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const store = new DbLockoutStore();
let target = { id: 0, username: "" };

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user;
}
async function call(method: string, path: string, role?: string) {
  const res = await fetch(baseUrl + path, { method, headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "workshop_manager", "management", "client"] as const) await login(role);
  const u = await createTestUser({ role: "technician" });
  ids.userIds.push(u.id);
  target = { id: u.id, username: u.username };
}, 180000);
afterAll(async () => {
  await db.execute(sql`DELETE FROM login_attempts_by_username WHERE username_normalized = ${target.username.trim().toLowerCase()}`);
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("/api/admin/users/locked et /unlock", { timeout: 120000 }, () => {
  it("refuse sans session et a tout role autre que l'administrateur", async () => {
    expect((await call("GET", LOCKED_USERS_PATH)).status).toBe(401);
    for (const role of ["workshop_manager", "management", "client"]) {
      expect((await call("GET", LOCKED_USERS_PATH, role)).status).toBe(403);
      expect((await call("POST", unlockUserPath(target.id), role)).status).toBe(403);
    }
  });

  it("liste le compte verrouille, le deverrouille, puis il disparait ; rejouable", async () => {
    const name = target.username.trim().toLowerCase();
    const now = new Date();
    for (let i = 0; i < LOCKOUT_DEFAULTS.maxAttempts; i++) {
      await store.registerFailure(name, now, { maxAttempts: LOCKOUT_DEFAULTS.maxAttempts, lockMinutes: LOCKOUT_DEFAULTS.lockMinutes });
    }
    const list = await call("GET", LOCKED_USERS_PATH, "admin");
    expect(list.status).toBe(200);
    expect(lockedUsersResponseSchema.safeParse(list.body).success).toBe(true);
    const mine = (list.body as { id: number; failedLoginCount: number }[]).find((u) => u.id === target.id);
    expect(mine?.failedLoginCount).toBe(LOCKOUT_DEFAULTS.maxAttempts);
    expect(leakText(list.body)).not.toMatch(/password|token/i);

    const unlock = await call("POST", unlockUserPath(target.id), "admin");
    expect(unlock.status).toBe(200);
    expect(unlockUserResponseSchema.safeParse(unlock.body).success).toBe(true);
    const after = await call("GET", LOCKED_USERS_PATH, "admin");
    expect((after.body as { id: number }[]).some((u) => u.id === target.id)).toBe(false);
    expect((await store.get(name)).failedCount).toBe(0);
    expect((await call("POST", unlockUserPath(target.id), "admin")).status).toBe(200);
  });

  it("404 pour un id inconnu, 400 pour un id invalide", async () => {
    expect((await call("POST", unlockUserPath(999999999), "admin")).status).toBe(404);
    expect((await call("POST", "/api/admin/users/abc/unlock", "admin")).status).toBe(400);
  });
});
