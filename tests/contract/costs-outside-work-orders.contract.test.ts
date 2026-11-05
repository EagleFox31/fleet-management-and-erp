import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicles, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Coûts lus hors de /api/work-orders : le chauffeur et le client n'en voient aucun.
 * - GET /api/statistics/maintenance-cost/:period : réservé à WORK_ORDER_COST_READ_ROLES.
 * - GET /api/vehicles/:id : ne porte ni les OT du véhicule ni leur coût, et masque le prix d'achat.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const cookies: Partial<Record<TestUserRole, string>> = {};
const PRICE_SENTINEL = "918273645";
const COST_SENTINEL = "827364591";
let vehicleId = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.get("set-cookie")!.split(";")[0];
  return user;
}

const get = (path: string, role: TestUserRole) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies[role]! } });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const role of ["admin", "workshop_manager", "technician", "driver"] as const) await login(role);
  const client = await login("client");
  const vehicle = await createTestVehicle({ ownerId: client.id });
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  await db.update(vehicles).set({ purchasePrice: PRICE_SENTINEL } as any).where(eq(vehicles.id, vehicle.id));
  const [wo] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST coût hors OT", status: "completed", cost: COST_SENTINEL })
    .returning();
  workOrderIds.push(wo.id);
}, 120000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("coût de maintenance de la flotte", { timeout: 120000 }, () => {
  it.each(["driver", "client"] as const)("%s : 403, aucun montant", async (role) => {
    const res = await get("/api/statistics/maintenance-cost/year", role);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain(COST_SENTINEL);
    expect(JSON.parse(text)).not.toHaveProperty("cost");
  });

  it("technicien : toujours refusé par la route", async () => {
    expect((await get("/api/statistics/maintenance-cost/year", "technician")).status).toBe(403);
  });

  it.each(["admin", "workshop_manager"] as const)("%s : 200 avec le coût", async (role) => {
    const res = await get("/api/statistics/maintenance-cost/year", role);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cost: expect.any(Number) });
  });
});

describe("fiche véhicule", { timeout: 120000 }, () => {
  it.each(["driver", "client"] as const)("%s : ni coût d'OT ni prix d'achat", async (role) => {
    const res = await get(`/api/vehicles/${vehicleId}`, role);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).id).toBe(vehicleId);
    expect(text).not.toContain(COST_SENTINEL);
    expect(text).not.toContain(PRICE_SENTINEL);
  });

  it("admin : prix d'achat présent, toujours aucun OT embarqué", async () => {
    const text = await (await get(`/api/vehicles/${vehicleId}`, "admin")).text();
    expect(text).toContain(PRICE_SENTINEL);
    expect(text).not.toContain(COST_SENTINEL);
  });
});
