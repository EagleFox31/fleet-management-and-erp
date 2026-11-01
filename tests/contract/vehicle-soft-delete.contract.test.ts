import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions, vehicles, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * VEH2, suppression d'un véhicule : masqué des listes, OT et missions passés
 * consultables, véhicule non assignable.
 *
 * La colonne `vehicles.deletedAt` existe et les listes la filtrent, mais aucune
 * route ne la pose : `DELETE /api/vehicles/:id` supprime physiquement la ligne
 * (le déclencheur l'archive). Un véhicule portant un OT fait donc échouer la
 * route (clé étrangère). Les cas qui posent `deletedAt` à la main prouvent le
 * comportement des consommateurs ; le dernier cas de la route porte le défaut.
 */

type Actor = "admin" | "technician";
const ACTORS: Record<Actor, TestUserRole> = { admin: "admin", technician: "technician" };

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const workOrderIds: number[] = [];
const missionIds: number[] = [];
const driverIds: number[] = [];
let adminId = 0;

async function call(method: string, path: string, options: { body?: unknown; actor?: Actor } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      Cookie: cookies.get(options.actor ?? "admin")!,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // corps non JSON
  }
  return { status: response.status, body };
}

/** Véhicule avec un OT et une mission passés, puis marqué supprimé. */
async function seedDeletedVehicle() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [wo] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: `TEST OT ${vehicle.registrationNumber}`, status: "completed" })
    .returning();
  workOrderIds.push(wo.id);
  const [driver] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORMÉ" })
    .returning();
  driverIds.push(driver.id);
  const [mission] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("ord"),
      pickupAddress: "Douala",
      deliveryAddress: "Yaoundé",
      status: "completed",
      createdBy: adminId,
    })
    .returning();
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "completed" });
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vehicle.id));
  return { vehicle, workOrderId: wo.id, missionId: mission.id, driverId: driver.id };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    if (actor === "admin") adminId = user.id;
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("VEH2 : véhicule supprimé", { timeout: 60000 }, () => {
  // Mise en place des cas ci-dessous : hors du `it`, une erreur de
  // préparation (500, coupure de base) fait échouer le hook, jamais passer le cas.
  let seededDeleted: Awaited<ReturnType<typeof seedDeletedVehicle>>;
  beforeAll(async () => {
    seededDeleted = await seedDeletedVehicle();
  }, 60000);

  it("est masqué de la liste et de la recherche, pas un véhicule actif", async () => {
    const active = await createTestVehicle();
    ids.vehicleIds.push(active.id);
    const { vehicle } = await seedDeletedVehicle();

    const list = await call("GET", `/api/vehicles?search=${encodeURIComponent(vehicle.registrationNumber)}`);
    expect(list.status).toBe(200);
    expect(list.body.vehicles.map((v: any) => v.id)).not.toContain(vehicle.id);

    const found = await call("GET", `/api/vehicles?search=${encodeURIComponent(active.registrationNumber)}`);
    expect(found.body.vehicles.map((v: any) => v.id)).toEqual([active.id]);
  });

  it("laisse consulter ses OT et ses missions passés", async () => {
    const { vehicle, workOrderId, missionId } = await seedDeletedVehicle();

    const wo = await call("GET", `/api/work-orders/${workOrderId}`);
    expect(wo.status).toBe(200);
    expect(wo.body.vehicleId).toBe(vehicle.id);

    const mission = await call("GET", `/api/missions/${missionId}`);
    expect(mission.status).toBe(200);
    expect(mission.body.id).toBe(missionId);
  });

  const missionBody = (vehicleId: number, driverId: number, orderNumber: string) => ({
    orderNumber,
    pickupAddress: "Douala",
    deliveryAddress: "Yaoundé",
    assignment: { vehicleId, driverId },
  });

  it("témoin : un véhicule actif et un chauffeur formé s'assignent à une mission (201)", async () => {
    const { driverId } = await seedDeletedVehicle();
    const active = await createTestVehicle();
    ids.vehicleIds.push(active.id);
    const res = await call("POST", "/api/missions", { body: missionBody(active.id, driverId, uniqueTestToken("ord")) });
    if (res.status === 201) missionIds.push(res.body.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("un véhicule supprimé n'est pas assignable à une mission (400)", async () => {
    const { vehicle, driverId } = seededDeleted;
    const orderKo = uniqueTestToken("ord");
    const res = await call("POST", "/api/missions", { body: missionBody(vehicle.id, driverId, orderKo) });
    if (res.status === 201) missionIds.push(res.body.id);
    expect(res.status).toBe(400);
    const created = await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, orderKo));
    expect(created).toHaveLength(0);
  });

  it("ne reçoit pas de nouvel OT (4xx)", async () => {
    const { vehicle } = seededDeleted;
    const res = await call("POST", "/api/work-orders", {
      body: { vehicleId: vehicle.id, title: "TEST OT sur véhicule supprimé" },
    });
    if (res.status === 201) workOrderIds.push(res.body.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("VEH2 : DELETE /api/vehicles/:id", { timeout: 60000 }, () => {
  let historyVehicleId = 0;
  let historyWorkOrderId = 0;
  let historyDeleteStatus = 0;
  beforeAll(async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    historyVehicleId = vehicle.id;
    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST OT historique", status: "completed" })
      .returning();
    workOrderIds.push(wo.id);
    historyWorkOrderId = wo.id;
    // L'appel visé est joué ici, son statut est l'objet de l'assertion du cas.
    historyDeleteStatus = (await call("DELETE", `/api/vehicles/${vehicle.id}`)).status;
  }, 60000);

  it("refuse un rôle non admin (403) sans toucher au véhicule", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const res = await call("DELETE", `/api/vehicles/${vehicle.id}`, { actor: "technician" });
    expect(res.status).toBe(403);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeNull();
  });

  it("répond 400 à un id invalide et 404 à un véhicule inconnu", async () => {
    expect((await call("DELETE", "/api/vehicles/abc")).status).toBe(400);
    expect((await call("DELETE", "/api/vehicles/2147483000")).status).toBe(404);
  });

  it("supprime un véhicule sans historique et le masque de la liste", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const res = await call("DELETE", `/api/vehicles/${vehicle.id}`);
    expect(res.status).toBe(200);
    const list = await call("GET", `/api/vehicles?search=${encodeURIComponent(vehicle.registrationNumber)}`);
    expect(list.body.vehicles.map((v: any) => v.id)).not.toContain(vehicle.id);
  });

  it("supprime un véhicule qui porte un OT en conservant l'OT consultable", async () => {
    expect(historyDeleteStatus).toBe(200);
    const after = await call("GET", `/api/work-orders/${historyWorkOrderId}`);
    expect(after.status).toBe(200);
    const [row] = await db.select().from(vehicles).where(eq(vehicles.id, historyVehicleId));
    expect(row?.deletedAt).not.toBeNull();
  });
});
