import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, clients, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Montants du budget d'une mission (Q19) par `/api/operations/*` : ces routes lisaient la ligne `missions`
 * entière et additionnaient `estimatedFuelCost` en « chiffre d'affaires ». Pour un client ou une destination
 * qui n'a qu'une mission, ce total est le montant exact.
 *
 * Magasinier et chauffeur n'en reçoivent aucun : chaque montant est une sentinelle cherchée dans
 * `JSON.stringify(body)` entier. Hors lecteurs, `totalRevenue`, `margin` et `marginPercentage` valent null, les
 * compteurs restent. La logistique, lectrice, voit les montants.
 */
const ACTORS = { logistics: "logistics", warehouse: "warehouse", driver: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ESTIMATED_FUEL_COST = 7418263;
const LEGACY = { fuelBudget: 6527149, roadExpensesBudget: 5193827, contingencyBudget: 4382917 };
const SENTINELS = [ESTIMATED_FUEL_COST, ...Object.values(LEGACY)].map(String);
const REVENUE_KEYS = ["totalRevenue", "margin", "marginPercentage"] as const;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
let missionId = 0;
let clientId = 0;
let driverRowId = 0;
const clientName = uniqueTestToken("OPSCLI");
const destination = uniqueTestToken("OPSDEST");

const leaked = (body: unknown) => SENTINELS.filter((s) => JSON.stringify(body).includes(s));

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
    .returning();
  driverRowId = d.id;
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [c] = await db.insert(clients).values({ name: clientName } as any).returning();
  clientId = c.id;
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("OBS"),
      pickupAddress: "TEST A",
      deliveryAddress: destination,
      status: "in_progress",
      clientId,
      estimatedFuelCost: String(ESTIMATED_FUEL_COST),
      workflowData: { budgetPlan: LEGACY },
    } as any)
    .returning();
  missionId = m.id;
  await db.insert(assignments).values({ missionId, vehicleId: v.id, driverId: driverRowId, status: "in_progress" } as any);
}, 120000);

afterAll(async () => {
  if (missionId) {
    await db.delete(assignments).where(inArray(assignments.missionId, [missionId]));
    await db.delete(missions).where(inArray(missions.id, [missionId]));
  }
  if (clientId) await db.delete(clients).where(inArray(clients.id, [clientId]));
  if (driverRowId) await db.delete(drivers).where(inArray(drivers.id, [driverRowId]));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

const containsMission = (body: unknown) => JSON.stringify(body).includes(`"id":${missionId},`);
const statRow = (body: unknown, key: "clientName" | "destination", value: string) =>
  (body as Record<string, unknown>[]).find((row) => row[key] === value || (row as any).client?.name === value);

describe("/api/operations : montants du budget réservés à leurs lecteurs (Q19)", { timeout: 180000 }, () => {
  for (const actor of ["warehouse", "driver"] as const) {
    it(`${actor} : listes de missions sans montant du budget`, async () => {
      for (const path of ["/api/operations/missions", "/api/operations/missions/active"]) {
        const res = await call("GET", path, { actor });
        expect(res.status, path).toBe(200);
        expect(containsMission(res.body), `${path} : mission visible`).toBe(true);
        expect(leaked(res.body), path).toEqual([]);
      }
    });

    it(`${actor} : missions d'un client et statistiques sans chiffre d'affaires`, async () => {
      for (const path of [`/api/operations/missions/by-client/${encodeURIComponent(clientName)}`, "/api/operations/stats/by-client", "/api/operations/stats/by-destination"]) {
        const res = await call("GET", path, { actor });
        // Le chauffeur est refusé sur ces routes (operationsCostReader) : la réponse ne porte alors aucun montant non plus.
        expect(res.status, path).toBe(actor === "driver" ? 403 : 200);
        expect(leaked(res.body), path).toEqual([]);
      }
    });
  }

  it("magasinier : revenu et marge à null, compteurs conservés", async () => {
    const byClient = await call("GET", `/api/operations/missions/by-client/${encodeURIComponent(clientName)}`, { actor: "warehouse" });
    expect(containsMission(byClient.body)).toBe(true);
    for (const key of REVENUE_KEYS) expect(byClient.body.statistics[key], `by-client statistics.${key}`).toBeNull();
    expect(byClient.body.statistics.totalMissions).toBe(1);

    const stats = await call("GET", "/api/operations/stats/by-client", { actor: "warehouse" });
    const clientRow = statRow(stats.body, "clientName", clientName) as Record<string, unknown>;
    expect(clientRow).toBeDefined();
    for (const key of REVENUE_KEYS) expect(clientRow[key], `stats/by-client ${key}`).toBeNull();
    // Alias exact du carburant estimé : masqué comme le nom déprécié (clé présente, valeur null).
    expect(clientRow).toHaveProperty("estimatedFuelCost", null);
    expect(clientRow.totalMissions).toBe(1);

    const dest = await call("GET", "/api/operations/stats/by-destination", { actor: "warehouse" });
    const destRow = statRow(dest.body, "destination", destination) as Record<string, unknown>;
    expect(destRow).toBeDefined();
    // Par destination, seul le revenu est calculé (ni marge ni pourcentage) ; le compteur s'appelle `count`.
    expect(destRow.totalRevenue).toBeNull();
    expect(destRow).toHaveProperty("estimatedFuelCost", null);
    expect(destRow.count).toBe(1);
  });

  it("logistique : montants et chiffre d'affaires visibles", async () => {
    const list = await call("GET", "/api/operations/missions", { actor: "logistics" });
    expect(JSON.stringify(list.body)).toContain(String(ESTIMATED_FUEL_COST));
    expect(JSON.stringify(list.body)).toContain(String(LEGACY.roadExpensesBudget));

    const byClient = await call("GET", `/api/operations/missions/by-client/${encodeURIComponent(clientName)}`, { actor: "logistics" });
    expect(Number(byClient.body.statistics.totalRevenue)).toBe(ESTIMATED_FUEL_COST);

    const stats = await call("GET", "/api/operations/stats/by-client", { actor: "logistics" });
    const clientRow = statRow(stats.body, "clientName", clientName) as any;
    expect(Number(clientRow.totalRevenue)).toBe(ESTIMATED_FUEL_COST);
    // Alias exact servi avec la même valeur ; `totalRevenue` reste servi une version (déprécié).
    expect(Number(clientRow.estimatedFuelCost)).toBe(ESTIMATED_FUEL_COST);

    const dest = await call("GET", "/api/operations/stats/by-destination", { actor: "logistics" });
    const destRow = statRow(dest.body, "destination", destination) as any;
    expect(Number(destRow.totalRevenue)).toBe(ESTIMATED_FUEL_COST);
    expect(Number(destRow.estimatedFuelCost)).toBe(ESTIMATED_FUEL_COST);
  });

  it("sans cookie : 401, aucun montant ni chiffre d'affaires", async () => {
    for (const path of ["/api/operations/missions", "/api/operations/stats/by-client"]) {
      const res = await call("GET", path);
      expect(res.status, path).toBe(401);
      for (const sentinel of [ESTIMATED_FUEL_COST, LEGACY.roadExpensesBudget]) expect(JSON.stringify(res.body), path).not.toContain(String(sentinel));
    }
  });
});
