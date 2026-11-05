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

/** Clés de montant, à toute profondeur de la réponse. */
function amountKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => amountKeys(item, found));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (/cost|price|amount|montant|valuation/i.test(key)) found.push(key);
      amountKeys(inner, found);
    }
  }
  return found;
}

describe("coût de maintenance de la flotte", { timeout: 120000 }, () => {
  it.each(["driver", "client", "technician"] as const)("%s : 403 par la garde, aucun montant", async (role) => {
    const res = await get("/api/statistics/maintenance-cost/year", role);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain(COST_SENTINEL);
    expect(JSON.parse(text).message).toBe("Accès non autorisé");
  });

  it("sans session : 401", async () => {
    expect((await fetch(`${baseUrl}/api/statistics/maintenance-cost/year`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/statistics/fleet-kpi`)).status).toBe(401);
  });

  it("variante de casse et barre finale : la garde s'applique toujours au chauffeur", async () => {
    expect((await get("/API/Statistics/Maintenance-Cost/YEAR/", "driver")).status).toBe(403);
    expect((await get("/API/Statistics/Fleet-KPI/", "driver")).status).toBe(403);
  });

  it.each(["admin", "workshop_manager"] as const)("%s : 200 avec le coût", async (role) => {
    const res = await get("/api/statistics/maintenance-cost/year", role);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cost: expect.any(Number) });
  });
});

describe("KPI de flotte (coût par véhicule)", { timeout: 120000 }, () => {
  it.each(["driver", "client"] as const)("%s : 403", async (role) => {
    const res = await get("/api/statistics/fleet-kpi", role);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("maintenanceCostPerVehicle");
  });

  it("technicien : 200 avec le coût par véhicule (tableau de bord atelier)", async () => {
    const res = await get("/api/statistics/fleet-kpi", "technician");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("maintenanceCostPerVehicle");
  });
});

describe("statistics/* : aucun montant pour le chauffeur ni le client", { timeout: 120000 }, () => {
  const routes = [
    "/api/statistics/maintenance-cost/year",
    "/api/statistics/fleet-kpi",
    "/api/statistics/fleet",
    "/api/statistics/fleet-history",
    "/api/statistics/maintenance-compliance",
    "/api/statistics/scheduled-maintenance",
    "/api/statistics/work-orders",
  ];
  const cases = routes.flatMap((path) => (["driver", "client"] as const).map((role) => [path, role] as const));

  it.each(cases)("%s × %s : refus ou réponse sans montant", async (path, role) => {
    const res = await get(path, role);
    const text = await res.text();
    expect(text).not.toContain(COST_SENTINEL);
    expect(text).not.toContain(PRICE_SENTINEL);
    if (res.status === 403) return;
    expect(res.status).toBe(200);
    expect(amountKeys(JSON.parse(text))).toEqual([]);
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
