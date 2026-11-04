import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/** POST /api/users et /api/auth/register : un PIN fourni est validé (4 chiffres) puis haché, jamais écrit en clair. */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const created: string[] = [];

async function post(path: string, body: unknown) {
  const res = await fetch(baseUrl + path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
function payload(tag: string, pin?: unknown) {
  const username = `pin-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  created.push(username);
  return { username, email: `${username}@test.local`, name: "Chauffeur PIN", password: "Motdepasse-Test-1", role: "driver", ...(pin !== undefined ? { pin } : {}) };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await fetch(baseUrl + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }) });
  cookie = res.headers.get("set-cookie")!.split(";")[0];
});
afterAll(async () => {
  if (created.length) {
    const rows = await db.select({ id: users.id }).from(users).where(inArray(users.username, created));
    ids.userIds.push(...rows.map((r) => r.id));
  }
  await cleanupCreated(ids);
  await new Promise((r) => server.close(r));
});

describe.each(["/api/users", "/api/auth/register"])("POST %s", (path) => {
  it("hache le PIN fourni", async () => {
    const body = payload("ok", "1234");
    const res = await post(path, body);
    expect(res.status).toBe(201);
    const [row] = await db.select({ pin: users.pin }).from(users).where(eq(users.username, body.username));
    expect(row.pin).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare("1234", row.pin!)).toBe(true);
  });
  it("refuse un PIN qui n'a pas 4 chiffres, sans rien écrire", async () => {
    const body = payload("bad", "12");
    const res = await post(path, body);
    expect(res.status).toBe(400);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username));
    expect(rows).toHaveLength(0);
  });
  it("sans PIN : NULL", async () => {
    const body = payload("none");
    expect((await post(path, body)).status).toBe(201);
    const [row] = await db.select({ pin: users.pin }).from(users).where(eq(users.username, body.username));
    expect(row.pin).toBeNull();
  });
});
