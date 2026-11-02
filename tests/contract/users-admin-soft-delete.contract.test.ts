import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * ADM1 : écriture des comptes réservée à l'admin.
 * ADM3 : un compte supprimé (soft delete) ne se connecte plus, sa session
 * ouverte tombe, il disparaît des listes et sa ligne reste en base.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
) {
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

async function login(username: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", {
    body: { username, password: TEST_USER_PASSWORD },
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!.split(";")[0];
}

async function newUser(role: "admin" | "warehouse" | "workshop_manager" = "warehouse") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  return user;
}

async function softDeleteAs(adminCookie: string, userId: number) {
  return call("DELETE", `/api/users/${userId}`, { cookie: adminCookie });
}

let adminCookie = "";

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await newUser("admin");
  adminCookie = await login(admin.username);
});

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("ADM1 : écriture des comptes réservée à l'admin", { timeout: 30000 }, () => {
  it("refuse création, modification et suppression à un non-admin", async () => {
    const warehouse = await newUser("warehouse");
    const target = await newUser("warehouse");
    const cookie = await login(warehouse.username);

    const token = uniqueTestToken("intrus");
    const created = await call("POST", "/api/users", {
      cookie,
      body: { username: token, email: `${token}@fleet.test`, name: token, role: "admin", password: "x" },
    });
    expect(created.status).toBe(403);
    expect((await call("PATCH", `/api/users/${target.id}`, { cookie, body: { role: "admin" } })).status).toBe(403);
    expect((await call("DELETE", `/api/users/${target.id}`, { cookie })).status).toBe(403);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.role).toBe("warehouse");
    expect(row.deletedAt).toBeNull();
  });

  it("refuse l'anonyme", async () => {
    const target = await newUser("warehouse");
    expect((await call("DELETE", `/api/users/${target.id}`)).status).toBe(401);
    expect((await call("PATCH", `/api/users/${target.id}`, { body: { role: "admin" } })).status).toBe(401);
  });

  it("l'admin ne peut pas supprimer son propre compte", async () => {
    const me = await call("GET", "/api/auth/me", { cookie: adminCookie });
    expect(me.status).toBe(200);
    const res = await softDeleteAs(adminCookie, me.body.id);
    expect(res.status).toBe(400);
  });
});

describe("ADM3 : soft delete d'un compte", { timeout: 30000 }, () => {
  it("supprime une fois (204), puis 404 ; la ligne reste en base", async () => {
    const target = await newUser("warehouse");
    expect((await softDeleteAs(adminCookie, target.id)).status).toBe(204);
    expect((await softDeleteAs(adminCookie, target.id)).status).toBe(404);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
  });

  it("le compte supprimé disparaît de la liste des utilisateurs", async () => {
    const target = await newUser("warehouse");
    expect((await softDeleteAs(adminCookie, target.id)).status).toBe(204);

    const list = await call("GET", "/api/users", { cookie: adminCookie });
    expect(list.status).toBe(200);
    const listed = (list.body as Array<{ id: number }>).map((u) => u.id);
    expect(listed).not.toContain(target.id);
  });

  it("refuse la connexion d'un compte supprimé", async () => {
    const target = await newUser("warehouse");
    expect((await softDeleteAs(adminCookie, target.id)).status).toBe(204);

    const res = await call("POST", "/api/auth/login", {
      body: { username: target.username, password: TEST_USER_PASSWORD },
    });
    expect(res.status).toBe(401);
  });

  it("la suppression révoque la session ouverte, y compris sur une route gardée par authenticate seul", async () => {
    const target = await newUser("warehouse");
    const cookie = await login(target.username);
    expect((await call("GET", "/api/parts", { cookie })).status).toBe(200);

    expect((await softDeleteAs(adminCookie, target.id)).status).toBe(204);
    expect((await call("GET", "/api/parts", { cookie })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("la désactivation par l'admin révoque aussi la session", async () => {
    const target = await newUser("warehouse");
    const cookie = await login(target.username);

    const toggled = await call("PATCH", `/api/admin/users/${target.id}/toggle`, {
      cookie: adminCookie,
      body: { isActive: false },
    });
    expect(toggled.status).toBe(200);
    expect((await call("GET", "/api/parts", { cookie })).status).toBe(401);
  });

  // Seconde ligne de défense : même si la session survit (suppression écrite
  // hors de la route), les gardes et le profil refusent le compte supprimé.
  it("une session survivante d'un compte supprimé ne passe ni les gardes ni le profil", async () => {
    const target = await newUser("warehouse");
    const cookie = await login(target.username);
    expect((await call("GET", "/api/feature-flags", { cookie })).status).toBe(200);

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, target.id));
    expect((await call("GET", "/api/feature-flags", { cookie })).status).toBe(401);
    expect((await call("GET", "/api/auth/me", { cookie })).status).toBe(401);
  });
});
