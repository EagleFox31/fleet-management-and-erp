import { createServer, type Server } from "http";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fleetKpiCache } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Recalcul des KPI de flotte (`POST /api/statistics/fleet-kpi/refresh`, admin seul) : réécrit la ligne
 * unique `fleet_kpi_cache` (id 1) que lit `GET /api/statistics/fleet-kpi`. Sans la fonction SQL
 * `calculate_fleet_kpi()`, le calcul applicatif prend le relais.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const PATH = "/api/statistics/fleet-kpi/refresh";

async function sessionOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const refresh = (cookie?: string) => fetch(baseUrl + PATH, { method: "POST", headers: cookie ? { Cookie: cookie } : {} });
const cacheRow = async () => (await db.select().from(fleetKpiCache).where(eq(fleetKpiCache.id, 1)))[0];

/** Ligne de cache visiblement fausse : un recalcul doit l'écraser. */
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
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("POST /api/statistics/fleet-kpi/refresh", { timeout: 120000 }, () => {
  it("hors admin : 401 sans session, 403 pour le chef d'atelier et le client, cache intact", async () => {
    await poisonCache();
    expect((await refresh()).status).toBe(401);
    for (const role of ["workshop_manager", "client"] as const) {
      expect((await refresh(await sessionOf(role))).status, role).toBe(403);
    }
    expect(await cacheRow()).toMatchObject({ totalVehicles: -1, totalWorkOrders: -1 });
  });

  it("admin : réécrit le cache à partir des véhicules et des OT, et le GET relit les mêmes valeurs", async () => {
    const admin = await sessionOf("admin");
    await poisonCache();
    const before = Date.now();

    const res = await refresh(admin);
    expect(res.status).toBe(200);
    const { kpi } = await res.json();

    const row = await cacheRow();
    expect(row.totalVehicles).toBeGreaterThanOrEqual(0);
    expect(row.totalVehicles).toBe(row.operationalVehicles + row.maintenanceVehicles + row.outOfServiceVehicles);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 5000);

    const [counts] = (
      await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed FROM work_orders`)
    ).rows as Array<{ total: number; completed: number }>;
    expect(row).toMatchObject({ totalWorkOrders: counts.total, completedWorkOrders: counts.completed });

    const expectedRate = row.totalVehicles > 0 ? Number(((row.operationalVehicles / row.totalVehicles) * 100).toFixed(2)) : 0;
    expect(row.availabilityRate).toBeCloseTo(expectedRate, 2);
    expect(kpi).toMatchObject({ availabilityRate: row.availabilityRate, mtbf: row.mtbf, mttr: row.mttr, downtimeHours: row.downtimeHours });

    const read = await fetch(`${baseUrl}/api/statistics/fleet-kpi`, { headers: { Cookie: admin } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ availabilityRate: row.availabilityRate });
  });
});
