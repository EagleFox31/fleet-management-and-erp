import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * ADM5 : connexion chauffeur par PIN (`POST /api/auth/pin-login`).
 * Bon PIN : session ouverte ; mauvais PIN, compte supprimé, rôle autre que
 * chauffeur ou PIN absent : refusé sans session. Le verrouillage après N
 * échecs est couvert par `login-guards-mount`.
 */

const PIN = "4821";

let server: Server;
let baseUrl = "";
const ids = createIdBag();

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

async function newDriver(overrides: { pin?: string | null; deletedAt?: Date; role?: "driver" | "warehouse" } = {}) {
  const pin = overrides.pin === undefined ? await bcrypt.hash(PIN, 4) : overrides.pin;
  const created = await createTestUser({ role: overrides.role ?? "driver" });
  ids.userIds.push(created.id);
  // La fabrique ne transmet ni `pin` ni `deletedAt`.
  const [user] = await db
    .update(users)
    .set({ pin, deletedAt: overrides.deletedAt ?? null })
    .where(eq(users.id, created.id))
    .returning();
  return user;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  const keys = ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`]);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ADM5 : connexion chauffeur par PIN", { timeout: 30000 }, () => {
  it("bon PIN : session chauffeur ouverte", async () => {
    const driver = await newDriver();
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: PIN } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: driver.id, role: "driver" });
    expect(res.body).not.toHaveProperty("pin");
    expect(res.body).not.toHaveProperty("password");

    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const me = await call("GET", "/api/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(driver.id);
  });

  it("mauvais PIN : 401, aucune session", async () => {
    const driver = await newDriver();
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: "0000" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("chauffeur supprimé : 401 et absent de la liste de connexion", async () => {
    const driver = await newDriver({ deletedAt: new Date() });
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: PIN } });
    expect(res.status).toBe(401);

    const list = await call("GET", "/api/auth/drivers-list");
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: number }>).map((d) => d.id)).not.toContain(driver.id);
  });

  it("chauffeur actif : présent dans la liste, sans PIN ni mot de passe", async () => {
    const driver = await newDriver();
    const list = await call("GET", "/api/auth/drivers-list");
    const entry = (list.body as Array<Record<string, unknown>>).find((d) => d.id === driver.id);
    expect(entry).toBeDefined();
    expect(Object.keys(entry!).sort()).toEqual(["id", "name"]);
  });

  it("compte non chauffeur : refusé même avec le bon PIN (401 unifié, plus de 403)", async () => {
    const warehouse = await newDriver({ role: "warehouse" });
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: warehouse.id, pin: PIN } });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("chauffeur sans PIN configuré : 401", async () => {
    const driver = await newDriver({ pin: null });
    const res = await call("POST", "/api/auth/pin-login", { body: { userId: driver.id, pin: PIN } });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Identifiants invalides");
  });

  it("corps incomplet : 400", async () => {
    expect((await call("POST", "/api/auth/pin-login", { body: { pin: PIN } })).status).toBe(400);
    expect((await call("POST", "/api/auth/pin-login", { body: { userId: 1 } })).status).toBe(400);
  });
});
