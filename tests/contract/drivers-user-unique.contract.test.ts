import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../server/db";
import { drivers } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * #113 : une fiche chauffeur par compte. Seconde fiche ou modification vers un compte déjà lié → 409,
 * jamais 500, sans écriture. /api/drivers/me ne lie plus un compte au premier homonyme : seul le
 * personnel fait le lien.
 */

const CONFLICT = "Matricule ou liaison utilisateur déjà utilisée";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];
let managerCookie = "";

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
  return { status: response.status, body };
}

async function login(user: { username: string }) {
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function newUser(role: "admin" | "logistics" | "driver", name?: string) {
  const user = await createTestUser({ role, ...(name ? { name } : {}) });
  ids.userIds.push(user.id);
  return user;
}

async function createDriver(extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/drivers", {
    cookie: managerCookie,
    body: { firstName: "Test", lastName: uniqueTestToken("chauffeur"), ...extra },
  });
  if (res.body?.id) driverIds.push(res.body.id);
  return res;
}

const linkedTo = async (userId: number) =>
  (await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, userId))).map((r) => r.id);

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  managerCookie = await login(await newUser("logistics"));
});

afterAll(async () => {
  if (driverIds.length) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  const keys = ids.userIds.map((id) => `pwd:${id}`);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("#113 : une fiche chauffeur par compte", { timeout: 60000 }, () => {
  it("l'index uq_drivers_user_id est posé au démarrage", async () => {
    const { rows } = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_drivers_user_id'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(user_id\) WHERE \(user_id IS NOT NULL\)/);
  });

  it("seconde fiche sur un compte déjà lié : 409, aucune fiche créée", async () => {
    const account = await newUser("driver");
    const first = await createDriver({ userId: account.id });
    expect(first.status).toBe(201);

    const before = await db.select({ id: drivers.id }).from(drivers);
    const second = await createDriver({ userId: account.id });
    expect(second.status).toBe(409);
    expect(second.body?.message).toBe(CONFLICT);
    expect(await linkedTo(account.id)).toEqual([first.body.id]);
    expect((await db.select({ id: drivers.id }).from(drivers)).length).toBe(before.length);
  });

  it("modification vers un compte déjà lié : 409 (pas 500), fiche inchangée", async () => {
    const account = await newUser("driver");
    const owner = await createDriver({ userId: account.id });
    const other = await createDriver();
    expect(owner.status).toBe(201);
    expect(other.status).toBe(201);

    const res = await call("PATCH", `/api/drivers/${other.body.id}`, { cookie: managerCookie, body: { userId: account.id } });
    expect(res.status).toBe(409);
    expect(res.body?.message).toBe(CONFLICT);
    const [unchanged] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, other.body.id));
    expect(unchanged.userId).toBeNull();
    expect(await linkedTo(account.id)).toEqual([owner.body.id]);
  });

  it("plusieurs fiches sans compte restent permises (index partiel)", async () => {
    expect((await createDriver({ userId: null })).status).toBe(201);
    expect((await createDriver({ userId: null })).status).toBe(201);
  });

  it("/me sans fiche liée : 404, aucun lien automatique à un homonyme", async () => {
    const lastName = uniqueTestToken("homonyme");
    const homonym = await createDriver({ firstName: "Homonyme", lastName });
    expect(homonym.status).toBe(201);
    const account = await newUser("driver", `Homonyme ${lastName}`);

    const res = await call("GET", "/api/drivers/me", { cookie: await login(account) });
    expect(res.status).toBe(404);
    const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, homonym.body.id));
    expect(row.userId).toBeNull();
    expect(await linkedTo(account.id)).toEqual([]);
  });

  it("création de compte pour une fiche déjà liée : 409, liaison et comptes inchangés", async () => {
    const adminCookie = await login(await newUser("admin"));
    const account = await newUser("driver");
    const linked = await createDriver({ userId: account.id });
    expect(linked.status).toBe(201);
    const email = `${uniqueTestToken("cu")}@fleet.test`;

    const res = await call("POST", `/api/drivers/${linked.body.id}/create-user`, {
      cookie: adminCookie,
      body: { pin: "1234", email },
    });
    expect(res.status).toBe(409);
    expect(res.body?.message).toBe("Ce chauffeur a déjà un compte utilisateur");
    expect(await linkedTo(account.id)).toEqual([linked.body.id]);
    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    expect(rows).toEqual([]);
  });

  it("création de compte pour une fiche sans compte : 201, fiche liée au nouveau compte", async () => {
    const adminCookie = await login(await newUser("admin"));
    const free = await createDriver();
    expect(free.status).toBe(201);
    const original = (globalThis as any).broadcastUpdate;
    const broadcast = vi.fn();
    (globalThis as any).broadcastUpdate = broadcast;
    let res;
    try {
      res = await call("POST", `/api/drivers/${free.body.id}/create-user`, {
        cookie: adminCookie,
        body: { pin: "1234", email: `${uniqueTestToken("cu")}@fleet.test` },
      });
    } finally {
      (globalThis as any).broadcastUpdate = original;
    }
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids.userIds.push(res.body.user.id);
    expect(await linkedTo(res.body.user.id)).toEqual([free.body.id]);
    // Temps réel : les autres profils sont prévenus, sans données personnelles.
    expect(broadcast).toHaveBeenCalledWith("driver_updated", expect.objectContaining({ entity: "driver", entityId: free.body.id }));
    expect(broadcast.mock.calls[0][1].payload.driver).not.toHaveProperty("cniNumber");
  });

  it("création de compte : diffusion en échec → 201 quand même, fiche liée", async () => {
    const adminCookie = await login(await newUser("admin"));
    const free = await createDriver();
    expect(free.status).toBe(201);
    const original = (globalThis as any).broadcastUpdate;
    (globalThis as any).broadcastUpdate = () => {
      throw new Error("diffusion indisponible");
    };
    let res;
    try {
      res = await call("POST", `/api/drivers/${free.body.id}/create-user`, {
        cookie: adminCookie,
        body: { pin: "1234", email: `${uniqueTestToken("cu")}@fleet.test` },
      });
    } finally {
      (globalThis as any).broadcastUpdate = original;
    }
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids.userIds.push(res.body.user.id);
    expect(await linkedTo(res.body.user.id)).toEqual([free.body.id]);
  });

  it("/me avec la fiche liée par le personnel : 200, cette fiche", async () => {
    const account = await newUser("driver");
    const linked = await createDriver({ userId: account.id });
    const res = await call("GET", "/api/drivers/me", { cookie: await login(account) });
    expect(res.status).toBe(200);
    expect(res.body.driver.id).toBe(linked.body.id);
  });
});
