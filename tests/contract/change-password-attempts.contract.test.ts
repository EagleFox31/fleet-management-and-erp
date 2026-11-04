import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unlockUserPath } from "../../shared/contracts/auth-lockout";
import { db } from "../../server/db";
import { CHANGE_PASSWORD_KEY_PREFIX, storedLockoutKey } from "../../server/services/login-lockout-db-store";
import { lockoutConfigFromEnv } from "../../server/services/login-lockout-service";
import { loginAttemptsByUsername } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Essais du mot de passe actuel sur POST /api/users/change-password : même compteur et même seuil que
 * la connexion, compté par compte de session (clé `cpw:<id>`), à part du compteur de connexion.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const MAX = lockoutConfigFromEnv().maxAttempts;
type Account = { id: number; username: string; cookie: string };
const accounts: Record<"a" | "b" | "c" | "admin", Account> = {} as never;

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

const login = (username: string, password: string) => call("POST", "/api/auth/login", { body: { username, password } });
const changePassword = (who: Account, currentPassword: string, newPassword = "nouveau-mot-de-passe-1") =>
  call("POST", "/api/users/change-password", { cookie: who.cookie, body: { currentPassword, newPassword } });

function lockoutKeys(): string[] {
  return Object.values(accounts).flatMap((a) => [storedLockoutKey(a.username), `${CHANGE_PASSWORD_KEY_PREFIX}${a.id}`]);
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const label of ["a", "b", "c", "admin"] as const) {
    const user = await createTestUser({ role: label === "admin" ? "admin" : "technician" });
    ids.userIds.push(user.id);
    const res = await login(user.username, TEST_USER_PASSWORD);
    expect(res.status).toBe(200);
    accounts[label] = { id: user.id, username: user.username, cookie: res.cookie! };
  }
}, 180000);

afterAll(async () => {
  const keys = lockoutKeys();
  if (keys.length) await db.delete(loginAttemptsByUsername).where(inArray(loginAttemptsByUsername.usernameNormalized, keys));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("change-password : limite d'essais du mot de passe actuel", { timeout: 120000 }, () => {
  it(`${MAX} échecs puis 429, même avec le bon mot de passe ; ni B ni la connexion de A ne sont touchés`, async () => {
    for (let i = 0; i < MAX; i++) {
      expect((await changePassword(accounts.a, `faux-${i}`)).status, `essai ${i + 1}`).toBe(401);
    }
    const locked = await changePassword(accounts.a, TEST_USER_PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("RATE_LIMITED");
    expect(locked.body.message).toMatch(/mot de passe actuel/i);
    expect(JSON.stringify(locked.body)).not.toContain(accounts.a.username);

    expect((await login(accounts.a.username, TEST_USER_PASSWORD)).status, "le mot de passe n'a pas changé, la connexion reste ouverte").toBe(200);
    expect((await changePassword(accounts.b, "faux")).status, "B a son propre compteur").toBe(401);
  });

  it("le déverrouillage admin lève aussi ce verrou", async () => {
    expect((await changePassword(accounts.a, TEST_USER_PASSWORD)).status, "A est encore bloqué").toBe(429);
    expect((await call("POST", unlockUserPath(accounts.a.id), { cookie: accounts.admin.cookie })).status).toBe(200);
    expect((await changePassword(accounts.a, TEST_USER_PASSWORD)).status).toBe(200);
  });

  it("un succès remet le compteur à zéro", async () => {
    for (let i = 0; i < MAX - 1; i++) expect((await changePassword(accounts.c, `faux-${i}`)).status).toBe(401);
    const newPassword = "nouveau-mot-de-passe-c";
    expect((await changePassword(accounts.c, TEST_USER_PASSWORD, newPassword)).status).toBe(200);
    for (let i = 0; i < MAX - 1; i++) expect((await changePassword(accounts.c, `faux-${i}`)).status, `essai ${i + 1}`).toBe(401);
    expect((await changePassword(accounts.c, newPassword, "encore-un-autre-1")).status).toBe(200);
  });

  it("le corps invalide n'est pas un échec compté", async () => {
    for (let i = 0; i < MAX + 1; i++) {
      expect((await call("POST", "/api/users/change-password", { cookie: accounts.b.cookie, body: {} })).status).toBe(400);
    }
    expect((await changePassword(accounts.b, TEST_USER_PASSWORD)).status).toBe(200);
  });
});
