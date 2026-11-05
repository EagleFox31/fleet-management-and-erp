import { createServer, type Server } from "http";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicles, workOrderItems, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 9 de #360 : validation stricte des identifiants de route sur ce qui restait de `server/api`
 * (`parseRouteId`), plus deux lectures de `server/routes.ts` (gelé, modifié en place).
 * - Écritures : `<id>abc` où `<id>` existe répond 400 avec son message, et l'objet `<id>` reste tel quel.
 * - `GET /api/vehicles/:id` : seuls des chiffres valent un id ; `<id>abc` est cherché comme immatriculation.
 * - `GET /api/users/:id` : monté sur `isAnyUser` (charge `req.user`) ; hors admin, chacun ne lit que son profil.
 */

const TITLE_PREFIX = "TEST lot 9";
const BAD = "2147483000abc";
const OUT_OF_RANGE = "99999999999";

let server: Server;
let baseUrl = "";
const cookies = new Map<string, string>();
const users = new Map<string, number>();
const ids = createIdBag();
let ownVehicleId = 0;

type Role = "admin" | "client" | "technician";

async function login(role: Role) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(response.status).toBe(200);
  cookies.set(role, response.headers.get("set-cookie")!.split(";")[0]);
  users.set(role, user.id);
}

async function call(role: Role, method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookies.get(role)! },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { message?: string } | null;
  return { status: response.status, message: json?.message };
}

async function createWorkOrder() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: `${TITLE_PREFIX} lignes`, status: "in_progress", technicianId: users.get("technician")! })
    .returning();
  return workOrder;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  await login("admin");
  await login("client");
  await login("technician");
  const vehicle = await createTestVehicle({ ownerId: users.get("client")! });
  ids.vehicleIds.push(vehicle.id);
  ownVehicleId = vehicle.id;
});

afterAll(async () => {
  // Retrouvées par préfixe, même après un rouge ou un lancement interrompu. Les lignes d'OT suivent en cascade.
  const leftovers = await db
    .select({ id: workOrders.id, vehicleId: workOrders.vehicleId })
    .from(workOrders)
    .where(like(workOrders.title, `${TITLE_PREFIX}%`));
  if (leftovers.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, leftovers.map((w) => w.id)));
  }
  ids.vehicleIds = [...new Set([...ids.vehicleIds, ...leftovers.map((w) => w.vehicleId).filter((id): id is number => id !== null)])];
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 9) : server/api, objet <id> intact", { timeout: 120000 }, () => {
  it("PUT /api/vehicles/<id>abc/mileage et maintenance-position : 400, véhicule inchangé", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [before] = await db
      .select({ mileage: vehicles.mileage, position: vehicles.maintenancePosition })
      .from(vehicles)
      .where(eq(vehicles.id, vehicle.id));

    const mileage = await call("admin", "PUT", `/api/vehicles/${vehicle.id}abc/mileage`, { kilometers: 987654 });
    expect(mileage).toEqual({ status: 400, message: "ID de véhicule invalide" });
    const position = await call("admin", "PUT", `/api/vehicles/${vehicle.id}abc/maintenance-position`, { position: "TEST lot 9" });
    expect(position).toEqual({ status: 400, message: "ID de véhicule invalide" });

    const [after] = await db
      .select({ mileage: vehicles.mileage, position: vehicles.maintenancePosition })
      .from(vehicles)
      .where(eq(vehicles.id, vehicle.id));
    expect(after).toEqual(before);
  });

  it("lignes d'OT sur <id>abc : 400, aucune ligne créée, ligne <id> ni modifiée ni supprimée", async () => {
    const workOrder = await createWorkOrder();
    const [item] = await db.insert(workOrderItems).values({ workOrderId: workOrder.id, customLabel: TITLE_PREFIX }).returning();

    const created = await call("admin", "POST", `/api/work-orders/${workOrder.id}abc/items`, { customLabel: `${TITLE_PREFIX} neuve`, estimatedHours: 1 });
    expect(created).toEqual({ status: 400, message: "ID d'ordre de travail invalide" });
    const patched = await call("admin", "PATCH", `/api/work-order-items/${item.id}abc`, { customLabel: `${TITLE_PREFIX} changée` });
    expect(patched).toEqual({ status: 400, message: "ID de ligne invalide" });
    const deleted = await call("admin", "DELETE", `/api/work-order-items/${item.id}abc`);
    expect(deleted).toEqual({ status: 400, message: "ID de ligne invalide" });

    const rows = await db.select({ id: workOrderItems.id, label: workOrderItems.customLabel }).from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrder.id));
    expect(rows).toEqual([{ id: item.id, label: TITLE_PREFIX }]);
  });

  it("parts-catalog : un id hors de l'int4 ou nul répond 400, la pièce existante reste intacte", async () => {
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    expect(await call("admin", "POST", `/api/parts/${OUT_OF_RANGE}/update-stock`, { adjustment: 1, reason: "TEST lot 9" })).toEqual({
      status: 400,
      message: "ID de pièce invalide",
    });
    expect(await call("admin", "PATCH", "/api/parts/0", { name: "TEST lot 9" })).toEqual({ status: 400, message: "ID de pièce invalide" });
    expect(await call("admin", "DELETE", "/api/parts/0")).toEqual({ status: 400, message: "ID de pièce invalide" });
  });

  it.each([
    ["PATCH", `/api/document-renewals/requests/${BAD}/status`, "ID invalide"],
    ["GET", `/api/supplier-invoices/${BAD}`, "Identifiant de facture invalide."],
    ["GET", `/api/supplier-invoices/${BAD}/settlements`, "ID facture invalide"],
    ["GET", `/api/part-requirements/by-part/${BAD}`, "ID de pièce invalide"],
    ["GET", `/api/work-orders/${BAD}/items`, "ID d'ordre de travail invalide"],
    ["GET", `/api/work-orders/${BAD}/pending-part-requirements`, "ID d'ordre de travail invalide"],
    ["GET", `/api/vehicles/${OUT_OF_RANGE}`, "ID de véhicule invalide"],
  ])("%s %s : 400", async (method, url, message) => {
    expect(await call("admin", method, url, method === "GET" ? undefined : { status: "in_progress" })).toEqual({ status: 400, message });
  });
});

describe("ids de route (lot 9) : lectures de server/routes.ts", { timeout: 120000 }, () => {
  it("GET /api/vehicles/:id : le client lit son véhicule par son id (témoin), pas par <id>abc", async () => {
    expect((await call("client", "GET", `/api/vehicles/${ownVehicleId}`)).status).toBe(200);
    expect(await call("client", "GET", `/api/vehicles/${ownVehicleId}abc`)).toEqual({ status: 404, message: "Véhicule non trouvé" });
  });

  it("GET /api/users/:id : chacun lit son profil, pas celui d'un autre", async () => {
    for (const role of ["technician", "client"] as const) {
      expect((await call(role, "GET", `/api/users/${users.get(role)}`)).status).toBe(200);
      expect(await call(role, "GET", `/api/users/${users.get("admin")}`)).toEqual({ status: 403, message: "Accès non autorisé" });
    }
    expect((await call("admin", "GET", `/api/users/${users.get("technician")}`)).status).toBe(200);
  });
});
