import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fuelRecords, vehicles } from "@shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 6 de #360 : validation stricte des identifiants sur les écritures de `server/routes.ts`
 * (gelé, modifié en place par `routeIdOrNaN`). Un identifiant suivi de lettres répond 400,
 * avec le message existant de chaque route, et l'objet de même préfixe n'est pas modifié.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const BAD = "2147483000abc";

const CASES: Array<[method: string, url: string, message: string]> = [
  ["POST", `/api/vehicles/${BAD}/mileage/sync`, "ID de véhicule invalide"],
  ["PATCH", `/api/vehicles/${BAD}`, "ID de véhicule invalide"],
  ["POST", `/api/vehicles/${BAD}/restore`, "ID de véhicule invalide"],
  ["POST", `/api/maintenance-schedules/1e0/generate-work-order`, "Identifiant de planification invalide."],
  ["PATCH", `/api/maintenance-schedules/${BAD}`, "ID de planification invalide"],
  ["PATCH", `/api/work-orders/${BAD}`, "ID d'ordre de travail invalide."],
  ["PATCH", `/api/fuel-records/${BAD}`, "ID d'enregistrement de carburant invalide"],
  ["PATCH", `/api/tires/${BAD}`, "ID de pneu invalide"],
  ["POST", `/api/vehicles/${BAD}/tires`, "ID de véhicule invalide"],
  ["PATCH", `/api/vehicle-tires/${BAD}`, "ID de pneu véhicule invalide"],
  ["PATCH", `/api/vehicle-tires/${BAD}/remove`, "ID de pneu véhicule invalide"],
];

function send(method: string, url: string, body: Record<string, unknown> = {}) {
  return fetch(baseUrl + url, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 6) : écritures strictes", { timeout: 120000 }, () => {
  it.each(CASES)("%s %s : 400", async (method, url, message) => {
    const response = await send(method, url);
    const body = (await response.json()) as { message?: string };
    expect(response.status).toBe(400);
    expect(body.message).toBe(message);
  });

  it("PATCH /api/vehicles/<id>abc ne modifie pas le véhicule <id>", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    expect((await send("PATCH", `/api/vehicles/${vehicle.id}abc`, { model: "LOT6" })).status).toBe(400);
    const [row] = await db.select({ model: vehicles.model }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.model).toBe(vehicle.model);
  });

  it("POST /api/vehicles/<id>abc/restore ne restaure pas le véhicule <id>", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, vehicle.id));
    expect((await send("POST", `/api/vehicles/${vehicle.id}abc/restore`)).status).toBe(400);
    const [row] = await db.select({ deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it("PATCH /api/fuel-records/<id>abc ne modifie pas le plein <id>", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const record = await createTestFuelRecord({ vehicleId: vehicle.id });
    ids.fuelRecordIds.push(record.id);
    expect((await send("PATCH", `/api/fuel-records/${record.id}abc`, { notes: "LOT6" })).status).toBe(400);
    const [row] = await db.select({ notes: fuelRecords.notes }).from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.notes).toBe(record.notes);
  });
});
