import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users, vehicles } from "@shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 5 de #360 : validation stricte des identifiants sur les suppressions et les listes d'OT par véhicule ou technicien de `server/routes.ts`
 * (gelé, modifié en place par `routeIdOrNaN`) et sur les statistiques carburant par véhicule.
 * Un identifiant suivi de lettres répond 400, avec le message existant de chaque route.
 * Le préfixe numérique vise un id absent : sur l'ancien code, le test échoue sans rien supprimer.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const BAD = "2147483000abc";

const CASES: Array<[method: string, url: string, message: string]> = [
  // Les deux suppressions d'utilisateur passent d'abord par la garde du dernier administrateur (#379), qui lit l'id strictement.
  ["DELETE", `/api/users/${BAD}`, "Identifiant d'utilisateur invalide."],
  ["DELETE", `/api/admin/users/${BAD}`, "Identifiant d'utilisateur invalide."],
  ["DELETE", `/api/vehicles/${BAD}`, "ID de véhicule invalide"],
  ["DELETE", `/api/maintenance-schedules/${BAD}`, "ID de planification invalide"],
  ["DELETE", `/api/work-orders/${BAD}`, "ID d'ordre de travail invalide."],
  ["DELETE", `/api/parts-used/${BAD}`, "ID de pièce utilisée invalide"],
  ["DELETE", `/api/fault-catalog/${BAD}`, "ID invalide"],
  ["DELETE", `/api/tires/${BAD}`, "ID de pneu invalide"],
  ["DELETE", `/api/workflows/documents/${BAD}`, "ID de document invalide"],
  ["GET", `/api/work-orders/vehicle/${BAD}`, "ID de véhicule invalide"],
  ["GET", `/api/work-orders/technician/${BAD}`, "ID de technicien invalide"],
  ["GET", `/api/fuel-card/vehicle/${BAD}/stats`, "ID de véhicule invalide"],
  ["GET", `/api/fuel-card/vehicle/${BAD}/anomalies`, "ID de véhicule invalide"],
];

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

describe("ids de route (lot 5) : suppressions strictes", { timeout: 120000 }, () => {
  it.each(CASES)("%s %s : 400", async (method, url, message) => {
    const response = await fetch(baseUrl + url, { method, headers: { Cookie: cookie } });
    const body = (await response.json()) as { message?: string };
    expect(response.status).toBe(400);
    expect(body.message).toBe(message);
  });

  it("DELETE /api/vehicles/<id>abc laisse le véhicule <id> intact", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const response = await fetch(`${baseUrl}/api/vehicles/${vehicle.id}abc`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(response.status).toBe(400);
    const [row] = await db.select({ deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.deletedAt).toBeNull();
  });

  // DELETE /api/users est une suppression douce (deletedAt) ; DELETE /api/admin/users efface la ligne.
  it.each([
    ["/api/users", "suppression douce"],
    ["/api/admin/users", "suppression définitive"],
  ])("DELETE %s/<id>abc laisse l'utilisateur <id> actif (%s)", async (prefix) => {
    const target = await createTestUser({ role: "technician" });
    ids.userIds.push(target.id);
    const response = await fetch(`${baseUrl}${prefix}/${target.id}abc`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(response.status).toBe(400);
    const rows = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, target.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });
});
