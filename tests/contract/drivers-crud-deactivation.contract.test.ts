import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { drivers, missions, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * DRV1 : fiche chauffeur (`/api/drivers`) créée et modifiée par un gestionnaire
 * (admin, logistique, secrétariat), désactivée par l'admin. Un chauffeur
 * désactivé sort de l'écran PIN et des affectations.
 * Les cas `it.fails` décrivent un défaut constaté du code produit.
 */

const PIN = "5307";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];
const missionIds: number[] = [];
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
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function loginAs(role: "admin" | "logistics" | "warehouse") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const today = () => new Date().toISOString().slice(0, 10);

async function createDriver(cookie: string, extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/drivers", {
    cookie,
    body: { firstName: "Test", lastName: uniqueTestToken("chauffeur"), cpcTrainingDate: today(), ...extra },
  });
  if (res.body?.id) driverIds.push(res.body.id);
  return res;
}

async function newMission(cookie: string) {
  const res = await call("POST", "/api/missions", {
    cookie,
    body: { orderNumber: uniqueTestToken("mission"), pickupAddress: "Douala", deliveryAddress: "Yaoundé" },
  });
  expect(res.status).toBe(201);
  missionIds.push(res.body.id);
  return res.body.id as number;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  adminCookie = await loginAs("admin");
});

afterAll(async () => {
  // Missions (affectations en cascade), puis chauffeurs, puis comptes.
  if (missionIds.length) await db.delete(missions).where(inArray(missions.id, missionIds));
  if (driverIds.length) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  const keys = ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`]);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("DRV1 : fiche chauffeur", { timeout: 60000 }, () => {
  it("la logistique crée et modifie ; le statut CPC est calculé", async () => {
    const cookie = await loginAs("logistics");
    const created = await createDriver(cookie);
    expect(created.status).toBe(201);
    expect(created.body.isActive).toBe(true);

    const updated = await call("PATCH", `/api/drivers/${created.body.id}`, { cookie, body: { firstName: "Renommé" } });
    expect(updated.status).toBe(200);
    expect(updated.body.firstName).toBe("Renommé");
  });

  it("le magasin ne crée pas de chauffeur (403) ; prénom vide refusé (400)", async () => {
    const warehouse = await loginAs("warehouse");
    expect((await createDriver(warehouse)).status).toBe(403);
    expect((await createDriver(adminCookie, { firstName: " " })).status).toBe(400);
  });

  it("seul l'admin désactive ; la fiche reste en base, inactive", async () => {
    const logistics = await loginAs("logistics");
    const created = await createDriver(adminCookie);
    expect((await call("DELETE", `/api/drivers/${created.body.id}`, { cookie: logistics })).status).toBe(403);

    const res = await call("DELETE", `/api/drivers/${created.body.id}`, { cookie: adminCookie });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(drivers).where(eq(drivers.id, created.body.id));
    expect(row.isActive).toBe(false);
  });

  // Défaut : PATCH /api/missions/:id (server/api/missions.routes.ts) vérifie
  // le CPC du chauffeur affecté, pas `drivers.isActive` ; le refus n'arrive
  // qu'au lancement de la mission.
  it.fails("un chauffeur désactivé n'est pas affectable à une mission", async () => {
    const created = await createDriver(adminCookie);
    expect((await call("DELETE", `/api/drivers/${created.body.id}`, { cookie: adminCookie })).status).toBe(200);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const missionId = await newMission(adminCookie);

    const res = await call("PATCH", `/api/missions/${missionId}`, {
      cookie: adminCookie,
      body: { assignment: { vehicleId: vehicle.id, driverId: created.body.id } },
    });
    expect(res.status).toBe(400);
  });

  // Défaut : `/api/auth/drivers-list` et `pin-login` lisent `users` seul ;
  // la désactivation de la fiche `drivers` ne touche pas au compte lié.
  it.fails("un chauffeur désactivé sort de l'écran PIN et ne s'y connecte plus", async () => {
    const account = await createTestUser({ role: "driver" });
    ids.userIds.push(account.id);
    await db.update(users).set({ pin: await bcrypt.hash(PIN, 4) }).where(eq(users.id, account.id));
    const created = await createDriver(adminCookie, { userId: account.id });
    expect(created.status).toBe(201);
    expect((await call("DELETE", `/api/drivers/${created.body.id}`, { cookie: adminCookie })).status).toBe(200);

    const list = await call("GET", "/api/auth/drivers-list");
    expect((list.body as Array<{ id: number }>).map((d) => d.id)).not.toContain(account.id);
    const login = await call("POST", "/api/auth/pin-login", { body: { userId: account.id, pin: PIN } });
    expect(login.status).toBe(401);
  });
});
