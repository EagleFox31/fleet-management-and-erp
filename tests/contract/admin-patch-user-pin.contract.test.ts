import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as userSessions from "../../server/lib/user-sessions";
import { db } from "../../server/db";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { loginAttemptsByUsername, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * PATCH /api/users/:id (admin) : un PIN fourni est validé (4 chiffres) puis haché ; il ouvre une session
 * par POST /api/auth/pin-login. Un PIN vide est ignoré.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const accounts: { id: number; username: string }[] = [];

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

async function newUser(role: "admin" | "driver") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  accounts.push({ id: user.id, username: user.username });
  return user;
}
async function login(username: string) {
  const res = await call("POST", "/api/auth/login", { body: { username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return res.cookie!;
}
const storedPin = async (id: number) => (await db.select({ pin: users.pin }).from(users).where(eq(users.id, id)))[0].pin;

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180000);

afterAll(async () => {
  const keys = accounts.flatMap((u) => [u.username, `pin:${u.id}`, `${CHANGE_PASSWORD_KEY_PREFIX}${u.id}`]).map(storedLockoutKey);
  if (keys.length) await db.delete(loginAttemptsByUsername).where(inArray(loginAttemptsByUsername.usernameNormalized, keys));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("PATCH /api/users/:id : PIN", { timeout: 120000 }, () => {
  it("PIN valide : stocké haché (bcrypt), jamais renvoyé, pin-login fonctionne", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const cookie = await login(admin.username);

    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie, body: { pin: "4821" } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("4821");
    expect(res.body).not.toHaveProperty("pin");

    const stored = (await storedPin(driver.id))!;
    expect(stored).not.toBe("4821");
    expect(stored.startsWith("$2")).toBe(true);
    expect(await bcrypt.compare("4821", stored)).toBe(true);

    const pinLogin = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: "4821" } });
    expect(pinLogin.status).toBe(200);
    expect(pinLogin.body.id).toBe(driver.id);
  });

  it.each(["12", "12345", "abcd", "48 1", {}])("PIN invalide %j : 400 lisible, base inchangée", async (bad) => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const cookie = await login(admin.username);

    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie, body: { pin: bad } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4 chiffres/);
    expect(await storedPin(driver.id)).toBeNull();
  });

  it("mot de passe trop court (sous la longueur de change-password) : 400 lisible, base inchangée ; utilisateur inconnu : 404", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const cookie = await login(admin.username);
    const before = (await db.select({ password: users.password }).from(users).where(eq(users.id, driver.id)))[0].password;

    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie, body: { password: "abc" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/au moins 6 caractères/);
    expect((await db.select({ password: users.password }).from(users).where(eq(users.id, driver.id)))[0].password).toBe(before);

    const missing = await call("PATCH", `/api/users/2147483000`, { cookie, body: { name: "TEST absent" } });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Utilisateur non trouvé");
  });

  it("PIN vide : ignoré (nom modifié, PIN inchangé)", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const cookie = await login(admin.username);
    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie, body: { pin: "", name: "TEST renommé" } });
    expect(res.status).toBe(200);
    expect(await storedPin(driver.id)).toBeNull();
  });
});

describe("PATCH /api/users/:id : révocation des sessions du compte visé", { timeout: 120000 }, () => {
  async function twoSessions(username: string) {
    const a = await login(username);
    const b = await login(username);
    expect(a).not.toBe(b);
    return { a, b };
  }
  const status = async (cookie: string) => (await call("GET", "/api/auth/me", { cookie })).status;
  const passwordOf = async (id: number) => (await db.select({ password: users.password }).from(users).where(eq(users.id, id)))[0].password;

  it("PIN d'un autre compte : ses deux sessions sont révoquées, la session admin reste", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const adminCookie = await login(admin.username);
    const s = await twoSessions(driver.username);

    expect((await call("PATCH", `/api/users/${driver.id}`, { cookie: adminCookie, body: { pin: "1357" } })).status).toBe(200);

    expect(await status(s.a)).toBe(401);
    expect(await status(s.b)).toBe(401);
    expect(await status(adminCookie)).toBe(200);
  });

  it("mot de passe d'un autre compte : ses sessions sont révoquées", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const adminCookie = await login(admin.username);
    const s = await twoSessions(driver.username);

    expect((await call("PATCH", `/api/users/${driver.id}`, { cookie: adminCookie, body: { password: "nouveau-mdp-admin-1" } })).status).toBe(200);
    expect(await status(s.a)).toBe(401);
    expect(await status(s.b)).toBe(401);
  });

  it("admin sur son propre compte : la session courante reste, l'autre est révoquée", async () => {
    const admin = await newUser("admin");
    const s = await twoSessions(admin.username);

    expect((await call("PATCH", `/api/users/${admin.id}`, { cookie: s.b, body: { password: "nouveau-mdp-admin-2" } })).status).toBe(200);
    expect(await status(s.b)).toBe(200);
    expect(await status(s.a)).toBe(401);
  });

  it("PATCH sans secret (nom seul) : aucune session révoquée", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const adminCookie = await login(admin.username);
    const s = await twoSessions(driver.username);

    expect((await call("PATCH", `/api/users/${driver.id}`, { cookie: adminCookie, body: { name: "TEST nom seul" } })).status).toBe(200);
    expect(await status(s.a)).toBe(200);
    expect(await status(s.b)).toBe(200);
  });

  it("DELETE des sessions en échec : secret inchangé en base, sessions intactes", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const adminCookie = await login(admin.username);
    const s = await twoSessions(driver.username);
    const before = await passwordOf(driver.id);

    const spy = vi.spyOn(userSessions, "deleteOtherUserSessions").mockRejectedValueOnce(new Error("panne simulée"));
    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie: adminCookie, body: { pin: "2468", password: "nouveau-mdp-admin-3" } });
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("panne simulée");
    expect(await storedPin(driver.id)).toBeNull();
    expect(await passwordOf(driver.id)).toBe(before);
    expect(await status(s.a)).toBe(200);
    expect(await status(s.b)).toBe(200);
  });

  it("fermeture des sockets qui jette après le commit : 200, nouveau secret en base, sessions révoquées", async () => {
    const admin = await newUser("admin");
    const driver = await newUser("driver");
    const adminCookie = await login(admin.username);
    const s = await twoSessions(driver.username);
    const before = await passwordOf(driver.id);

    const spy = vi.spyOn(userSessions, "closeOtherUserConnections").mockImplementationOnce(() => {
      throw new Error("socket en panne");
    });
    const res = await call("PATCH", `/api/users/${driver.id}`, { cookie: adminCookie, body: { password: "nouveau-mdp-admin-4" } });
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(await passwordOf(driver.id)).not.toBe(before);
    expect(await status(s.a)).toBe(401);
  });
});
