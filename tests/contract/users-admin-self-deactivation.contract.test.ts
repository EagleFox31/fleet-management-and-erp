import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Un admin ne se désactive pas lui-même (PATCH /api/admin/users/:id/toggle),
 * comme il ne se supprime pas (DELETE /api/users/:id). La désactivation d'un
 * autre compte et la réactivation restent possibles.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
let adminCookie = "";
let adminId = 0;

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

const deletedAtOf = async (id: number) =>
  (await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, id)))[0].deletedAt;

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  adminId = admin.id;
  const res = await call("POST", "/api/auth/login", { body: { username: admin.username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  adminCookie = res.headers.get("set-cookie")!.split(";")[0];
}, 60000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ADM1 : un admin ne se désactive pas lui-même", { timeout: 30000 }, () => {
  it("refuse (400) et laisse le compte actif, session intacte", async () => {
    const res = await call("PATCH", `/api/admin/users/${adminId}/toggle`, { cookie: adminCookie, body: { isActive: false } });
    expect(res.status).toBe(400);
    expect(await deletedAtOf(adminId)).toBeNull();
    expect((await call("GET", "/api/auth/me", { cookie: adminCookie })).status).toBe(200);
  });

  it("désactive puis réactive un autre compte", async () => {
    const target = await createTestUser({ role: "warehouse" });
    ids.userIds.push(target.id);
    const off = await call("PATCH", `/api/admin/users/${target.id}/toggle`, { cookie: adminCookie, body: { isActive: false } });
    expect(off.status).toBe(200);
    expect(await deletedAtOf(target.id)).not.toBeNull();
    const on = await call("PATCH", `/api/admin/users/${target.id}/toggle`, { cookie: adminCookie, body: { isActive: true } });
    expect(on.status).toBe(200);
    expect(await deletedAtOf(target.id)).toBeNull();
  });

  it("la réactivation de son propre compte n'est pas bloquée", async () => {
    const res = await call("PATCH", `/api/admin/users/${adminId}/toggle`, { cookie: adminCookie, body: { isActive: true } });
    expect(res.status).toBe(200);
  });
});
