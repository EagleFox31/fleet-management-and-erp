import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 7 de #360 : validation stricte des identifiants sur les lectures de `server/routes.ts`
 * (gelé, modifié en place par `routeIdOrNaN`).
 * - Un client propriétaire du véhicule `<id>` qui demande `<id>abc` reçoit 400 : la route ne lit
 *   plus le véhicule `<id>` à partir d'un identifiant mal formé.
 * - Côté personnel, un identifiant suivi de lettres répond 400 avec le message existant.
 */

let server: Server;
let baseUrl = "";
const cookies = new Map<string, string>();
const ids = createIdBag();
const BAD = "2147483000abc";
let vehicleId = 0;

async function login(role: "admin" | "client") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(response.status).toBe(200);
  cookies.set(role, response.headers.get("set-cookie")!.split(";")[0]);
  return user;
}

async function get(role: "admin" | "client", url: string) {
  const response = await fetch(baseUrl + url, { headers: { Cookie: cookies.get(role)! } });
  const body = (await response.json()) as { message?: string };
  return { status: response.status, message: body?.message };
}

const CLIENT_CASES: Array<[path: (id: number) => string, message: string]> = [
  [(id) => `/api/vehicles/${id}abc/documents`, "ID de véhicule invalide"],
  [(id) => `/api/vehicles/${id}abc/documents/registration`, "ID de véhicule invalide"],
  [(id) => `/api/maintenance-schedules/vehicle/${id}abc`, "ID de véhicule invalide"],
  [(id) => `/api/fuel-records/vehicle/${id}abc`, "ID de véhicule invalide"],
  [(id) => `/api/vehicles/${id}abc/mileage`, "ID de véhicule invalide"],
  [(id) => `/api/vehicles/${id}abc/mileage/history`, "ID de véhicule invalide"],
  [(id) => `/api/vehicles/${id}abc/status-history`, "ID de véhicule invalide"],
  [(id) => `/api/vehicles/${id}abc/tires`, "ID de véhicule invalide"],
];

const STAFF_CASES: Array<[url: string, message: string]> = [
  [`/api/users/${BAD}`, "ID d'utilisateur invalide"],
  [`/api/documents/${BAD}/download`, "ID de document invalide"],
  [`/api/work-orders/1e0`, "ID d'ordre de travail invalide."],
  [`/api/technician/work-orders/${BAD}`, "ID technicien invalide"],
  [`/api/work-orders/${BAD}/parts`, "ID d'ordre de travail invalide."],
  [`/api/work-orders/${BAD}/tire-rotations`, "ID d'ordre de travail invalide."],
  [`/api/parts/${BAD}/stock-history`, "ID de pièce invalide"],
  [`/api/parts/${BAD}/work-orders`, "ID de pièce invalide"],
  [`/api/parts/${BAD}/usage-history`, "ID de pièce invalide"],
  [`/api/parts/${BAD}/real-stock`, "ID de pièce invalide"],
  [`/api/suppliers/${BAD}/invoices/payment`, "ID fournisseur invalide"],
  [`/api/invoices/${BAD}/parts`, "ID facture invalide"],
  [`/api/tires/${BAD}`, "ID de pneu invalide"],
  [`/api/workflows/documents/${BAD}`, "ID de document invalide"],
  [`/api/tire-inspections/${BAD}`, "ID d'inspection invalide"],
  [`/api/vehicle-tires/${BAD}/last-inspection`, "ID de pneu véhicule invalide."],
  [`/api/tire-rotations/${BAD}/details`, "ID de rotation invalide."],
];

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  await login("admin");
  const client = await login("client");
  const vehicle = await createTestVehicle({ ownerId: client.id });
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 7) : lectures strictes", { timeout: 120000 }, () => {
  it("le client lit son véhicule par un identifiant valide (témoin)", async () => {
    expect((await get("client", `/api/vehicles/${vehicleId}/mileage`)).status).toBe(200);
  });

  it.each(CLIENT_CASES)("client, véhicule <id>abc : 400 (%#)", async (path, message) => {
    const { status, message: body } = await get("client", path(vehicleId));
    expect(status).toBe(400);
    expect(body).toBe(message);
  });

  it.each(STAFF_CASES)("GET %s : 400", async (url, message) => {
    const { status, message: body } = await get("admin", url);
    expect(status).toBe(400);
    expect(body).toBe(message);
  });
});
