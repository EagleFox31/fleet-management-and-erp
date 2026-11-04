import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import * as userSessions from "../../server/lib/user-sessions";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { loginAttemptsByUsername, users } from "../../shared/schema";
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
const created: Account[] = [];

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
  created.push({ id: user.id, username: user.username });
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
  const keys = created.flatMap((u) => [u.username, `${CHANGE_PASSWORD_KEY_PREFIX}${u.id}`]).map(storedLockoutKey);
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

  // Moyen choisi pour faire échouer le DELETE : vi.spyOn sur l'export `deleteOtherUserSessions` du module
  // user-sessions (la route l'appelle par l'import ESM, donc l'espion est vu). Il rejette une fois, dans la
  // transaction : le hash écrit juste avant doit être annulé avec elle.
  it("DELETE des autres sessions en échec : erreur, hash inchangé, ancien mot de passe valide, autre session valide", async () => {
    const user = await newUser();
    const s = await twoSessions(user.username);
    const hashOf = async () => (await db.select({ p: users.password }).from(users).where(eq(users.id, user.id)))[0].p;
    const before = await hashOf();

    const spy = vi.spyOn(userSessions, "deleteOtherUserSessions").mockRejectedValueOnce(new Error("panne simulée"));
    const res = await call("POST", "/api/users/change-password", {
      cookie: s.b,
      body: { currentPassword: TEST_USER_PASSWORD, newPassword: "nouveau-mot-de-passe-4" },
    });
    spy.mockRestore();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toContain("panne simulée");
    expect(await hashOf(), "hash inchangé").toBe(before);
    expect((await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } })).status, "ancien mot de passe valide").toBe(200);
    expect((await call("GET", "/api/auth/me", { cookie: s.a })).status, "l'autre session est toujours valide").toBe(200);
  });

  it("fermeture des sockets qui jette après le commit : 200 et nouveau hash en base", async () => {
    const user = await newUser();
    const s = await twoSessions(user.username);
    const hashOf = async () => (await db.select({ p: users.password }).from(users).where(eq(users.id, user.id)))[0].p;
    const before = await hashOf();

    const spy = vi.spyOn(userSessions, "closeOtherUserConnections").mockImplementationOnce(() => {
      throw new Error("socket en panne");
    });
    const res = await call("POST", "/api/users/change-password", {
      cookie: s.b,
      body: { currentPassword: TEST_USER_PASSWORD, newPassword: "nouveau-mot-de-passe-5" },
    });
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(await hashOf()).not.toBe(before);
    expect((await call("GET", "/api/auth/me", { cookie: s.a })).status).toBe(401);
  });

  it("deux changements concurrents du même compte : un seul 200, l'autre 409, le hash final est celui du gagnant", async () => {
    const user = await newUser();
    const s = await twoSessions(user.username);
    const change = (cookie: string, newPassword: string) =>
      call("POST", "/api/users/change-password", { cookie, body: { currentPassword: TEST_USER_PASSWORD, newPassword } });

    // Barrière sur bcrypt.hash : les deux requêtes ont lu l'ancien hash avant que l'une n'écrive.
    const realHash = bcrypt.hash.bind(bcrypt) as (...args: any[]) => Promise<string>;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(bcrypt, "hash").mockImplementation((async (...args: any[]) => {
      if (++arrived === 2) release();
      await gate;
      return realHash(...args);
    }) as any);
    const [ra, rb] = await Promise.all([change(s.a, "mot-de-passe-gagnant-A1"), change(s.b, "mot-de-passe-gagnant-B1")]);
    spy.mockRestore();
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(JSON.stringify([ra.body, rb.body])).toMatch(/modifié entre-temps/);

    const winner = ra.status === 200 ? "mot-de-passe-gagnant-A1" : "mot-de-passe-gagnant-B1";
    const [row] = await db.select({ p: users.password }).from(users).where(eq(users.id, user.id));
    expect(await bcrypt.compare(winner, row.p)).toBe(true);
  });
});
