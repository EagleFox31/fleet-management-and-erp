import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { loginAttemptsByUsername } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Changement de mot de passe : les AUTRES sessions du compte sont révoquées, la session courante reste
 * ouverte. Un mot de passe actuel faux ne révoque rien.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
type Account = { id: number; username: string };
const users: Account[] = [];

async function call(method: string, path: string, options: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function newUser() {
  const user = await createTestUser({ role: "technician" });
  ids.userIds.push(user.id);
  users.push({ id: user.id, username: user.username });
  return user;
}

async function twoSessions(username: string) {
  const a = await call("POST", "/api/auth/login", { body: { username, password: TEST_USER_PASSWORD } });
  const b = await call("POST", "/api/auth/login", { body: { username, password: TEST_USER_PASSWORD } });
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(a.cookie).not.toBe(b.cookie);
  return { a: a.cookie!, b: b.cookie! };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180000);

afterAll(async () => {
  const keys = users.flatMap((u) => [u.username, `${CHANGE_PASSWORD_KEY_PREFIX}${u.id}`]).map(storedLockoutKey);
  if (keys.length) await db.delete(loginAttemptsByUsername).where(inArray(loginAttemptsByUsername.usernameNormalized, keys));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("change-password : révocation des autres sessions", { timeout: 120000 }, () => {
  it("B change le mot de passe : B reste connectée, A (autre session du même compte) reçoit 401", async () => {
    const user = await newUser();
    const s = await twoSessions(user.username);
    expect((await call("GET", "/api/auth/me", { cookie: s.a })).status).toBe(200);

    const res = await call("POST", "/api/users/change-password", {
      cookie: s.b,
      body: { currentPassword: TEST_USER_PASSWORD, newPassword: "nouveau-mot-de-passe-1" },
    });
    expect(res.status).toBe(200);
    expect(res.body.otherSessionsRevoked).toBe(true);

    expect((await call("GET", "/api/auth/me", { cookie: s.b })).status, "la session courante reste ouverte").toBe(200);
    expect((await call("GET", "/api/auth/me", { cookie: s.a })).status, "l'autre session est révoquée").toBe(401);
  });

  it("mot de passe actuel faux : aucune session révoquée", async () => {
    const user = await newUser();
    const s = await twoSessions(user.username);

    const res = await call("POST", "/api/users/change-password", {
      cookie: s.b,
      body: { currentPassword: "faux-mot-de-passe", newPassword: "nouveau-mot-de-passe-2" },
    });
    expect(res.status).toBe(401);

    expect((await call("GET", "/api/auth/me", { cookie: s.a })).status).toBe(200);
    expect((await call("GET", "/api/auth/me", { cookie: s.b })).status).toBe(200);
  });

  it("ne touche pas les sessions d'un autre compte", async () => {
    const user = await newUser();
    const other = await newUser();
    const s = await twoSessions(user.username);
    const o = await call("POST", "/api/auth/login", { body: { username: other.username, password: TEST_USER_PASSWORD } });

    expect(
      (await call("POST", "/api/users/change-password", {
        cookie: s.b,
        body: { currentPassword: TEST_USER_PASSWORD, newPassword: "nouveau-mot-de-passe-3" },
      })).status,
    ).toBe(200);

    expect((await call("GET", "/api/auth/me", { cookie: o.cookie })).status).toBe(200);
  });
});
