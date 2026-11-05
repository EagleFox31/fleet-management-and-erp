import { createServer, type Server } from "http";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { fleetKpiCache, vehicles } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Panne de lecture du décompte de flotte (`vehicleStatusService.getFleetStatistics`) : elle remonte
 * en 500 lisible au lieu d'une flotte vide. Sans cela, le recalcul des KPI écrivait des zéros dans
 * `fleet_kpi_cache` et répondait 200, et les tableaux de bord affichaient 0 véhicule.
 *
 * La panne est réelle côté service : seule la requête de décompte par statut (`db.select` sur
 * `vehicles.status`) lève, le `catch` du service est donc exercé.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const FAILURE = "panne de lecture simulée";

function failFleetCount() {
  const original = db.select.bind(db);
  return vi.spyOn(db, "select").mockImplementation(((fields?: Record<string, unknown>) => {
    if (fields && fields.status === vehicles.status && "count" in fields) throw new Error(FAILURE);
    return original(fields as any);
  }) as any);
}

async function poisonCache() {
  await db.execute(sql`
    INSERT INTO fleet_kpi_cache (id, availability_rate, total_vehicles, total_work_orders, calculated_at, updated_at)
    VALUES (1, -1, -1, -1, '2000-01-01', '2000-01-01')
    ON CONFLICT (id) DO UPDATE SET availability_rate = -1, total_vehicles = -1, total_work_orders = -1,
      calculated_at = '2000-01-01', updated_at = '2000-01-01'`);
}

beforeAll(async () => {
  server = createServer(await getContractApp());
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
}, 120000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Remet le cache à une valeur calculée (sinon -1 resterait pour les fichiers suivants).
  await fetch(`${baseUrl}/api/statistics/fleet-kpi/refresh`, { method: "POST", headers: { Cookie: cookie } });
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function expectReadableServerError(res: Response) {
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain(FAILURE);
  expect(JSON.parse(text).message).toEqual(expect.any(String));
}

describe("panne de lecture du décompte de flotte", { timeout: 120000 }, () => {
  it("recalcul des KPI : 500, cache non réécrit", async () => {
    await poisonCache();
    failFleetCount();
    await expectReadableServerError(
      await fetch(`${baseUrl}/api/statistics/fleet-kpi/refresh`, { method: "POST", headers: { Cookie: cookie } }),
    );
    vi.restoreAllMocks();
    const [row] = await db.select().from(fleetKpiCache).where(eq(fleetKpiCache.id, 1));
    expect(row).toMatchObject({ totalVehicles: -1, totalWorkOrders: -1 });
  });

  it("statistiques de flotte : 500, pas une flotte vide", async () => {
    failFleetCount();
    await expectReadableServerError(await fetch(`${baseUrl}/api/statistics/fleet`, { headers: { Cookie: cookie } }));
  });

  it("tableau de bord Direction : 500 sans détail technique", async () => {
    failFleetCount();
    await expectReadableServerError(await fetch(`${baseUrl}/api/management/dashboard`, { headers: { Cookie: cookie } }));
  });
});
