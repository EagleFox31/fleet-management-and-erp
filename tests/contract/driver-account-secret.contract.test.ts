import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { drivers, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";

/**
 * Compte chauffeur créé par POST /api/drivers/:id/create-user : le mot de passe et le PIN sont deux secrets
 * indépendants (la création est couverte par pin-login-hardening, E2). Ici : après un changement de PIN par
 * l'admin, ni l'ancien ni le nouveau PIN n'ouvre /api/auth/login, et seul le nouveau ouvre pin-login.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];
const usernames: string[] = [];
let adminCookie = "";

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function loginAdmin() {
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function newDriverAccount(pin: string) {
  const created = await call("POST", "/api/drivers", {
    cookie: adminCookie,
    body: { firstName: "Test", lastName: uniqueTestToken("chauffeur") },
  });
  expect(created.status).toBe(201);
  driverIds.push(created.body.id);
  const email = `${uniqueTestToken("drv")}@fleet.test`;
  const res = await call("POST", `/api/drivers/${created.body.id}/create-user`, { cookie: adminCookie, body: { pin, email } });
  expect(res.status).toBe(201);
  ids.userIds.push(res.body.user.id);
  usernames.push(res.body.user.username);
  return { id: res.body.user.id as number, username: res.body.user.username as string, body: res.body };
}

const loginWith = (username: string, password: string) => call("POST", "/api/auth/login", { body: { username, password } });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminCookie = await loginAdmin();
}, 180000);

afterAll(async () => {
  if (driverIds.length) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  const keys = ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`]);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys.map(storedLockoutKey)]);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [usernames.map(storedLockoutKey)]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("secret des comptes chauffeur", { timeout: 120000 }, () => {
  it("après un changement de PIN : l'ancien PIN et le nouveau refusés sur /api/auth/login, le nouveau accepté sur pin-login", async () => {
    const account = await newDriverAccount("4821");

    const patch = await call("PATCH", `/api/users/${account.id}`, { cookie: adminCookie, body: { pin: "7390" } });
    expect(patch.status).toBe(200);

    expect((await loginWith(account.username, "4821")).status, "ancien PIN comme mot de passe").toBe(401);
    expect((await loginWith(account.username, "7390")).status, "nouveau PIN comme mot de passe").toBe(401);

    const pinLogin = await call("POST", "/api/auth/pin-login", { body: { userId: account.id, pin: "7390" } });
    expect(pinLogin.status).toBe(200);
    expect(pinLogin.body.id).toBe(account.id);
    expect((await call("POST", "/api/auth/pin-login", { body: { userId: account.id, pin: "4821" } })).status).toBe(401);
  });
});
