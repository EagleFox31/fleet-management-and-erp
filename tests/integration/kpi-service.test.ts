import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { partsUsed, tireRotations, workOrders } from "../../shared/schema";
import { kpiService } from "../../server/services/kpi-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestVehicle } from "../support/factories";

const ids = createIdBag();
const woIds: number[] = [];
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

afterEach(async () => {
  if (woIds.length) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
    await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, woIds));
    await db.delete(workOrders).where(inArray(workOrders.id, woIds));
    woIds.length = 0;
  }
  await cleanupCreated(ids);
  ids.partIds.length = 0;
  ids.vehicleIds.length = 0;
});

/** Jeu connu, daté de 2019 pour ne pas se mélanger aux données existantes. */
async function seed() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart();
  ids.partIds.push(part.id);

  const mk = async (v: Partial<typeof workOrders.$inferInsert>) => {
    const [row] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST-kpi", ...v })
      .returning();
    woIds.push(row.id);
    return row;
  };
  const a = await mk({ status: "completed", startDate: at("2019-03-10"), endDate: at("2019-03-11"), cost: "10000" });
  await mk({ status: "in_progress", startDate: at("2019-03-20") });
  await mk({ status: "cancelled", startDate: at("2019-03-21") });
  await mk({ status: "pending", startDate: at("2019-04-05") });
  const e = await mk({
    status: "completed", isPreventive: true, duration: 60,
    startDate: at("2019-03-05"), endDate: at("2019-03-05"), cost: "20000",
  });
  await mk({
    status: "completed", isPreventive: true, startDate: at("2019-04-01"), endDate: at("2019-04-04"), cost: "0",
  });
  await mk({ status: "pending", isPreventive: true, startDate: at("2019-04-10") });

  await db.insert(partsUsed).values([
    { workOrderId: a.id, partId: part.id, quantity: 2, unitPrice: "1500" },
    { workOrderId: e.id, partId: part.id, quantity: 1, unitPrice: "5000" },
  ]);
  // Deux rotations sur le même OT que deux lignes de pièces : vérifie aussi
  // l'absence de produit cartésien entre les deux jointures.
  const rotation = { vehicleId: vehicle.id, workOrderId: a.id, rotationDate: "2019-03-11", rotationMileage: 1000 };
  await db.insert(tireRotations).values([
    { ...rotation, rotationType: "front_to_back", cost: "2000" },
    { ...rotation, rotationType: "cross_rotation", cost: "500" },
  ]);
}

const period = { from: "2019-03-01", to: "2019-04-30" };

describe("kpiService", () => {
  it("compte les incidents correctifs non annulés par mois de panne", async () => {
    await seed();
    const res = await kpiService.incidentsPerMonth(period);
    expect(res.filter((r) => r.month.startsWith("2019-"))).toEqual([
      { month: "2019-03", count: 2 },
      { month: "2019-04", count: 1 },
    ]);
  }, 30_000);

  it("mesure la conformité préventive (1 à temps sur 3 échus)", async () => {
    await seed();
    const res = await kpiService.preventiveCompliance(period);
    expect(res.planned).toBe(3);
    expect(res.doneOnTime).toBe(1);
    expect(res.rate).toBeCloseTo(1 / 3, 5);
  }, 30_000);

  it("calcule le coût moyen (base + pièces + pneus, WO5) sans double comptage", async () => {
    await seed();
    const res = await kpiService.avgCostPerIntervention(period);
    // OT clos : 10000+3000+2500, 20000+5000, 0 = 40500 sur 3
    expect(res).toEqual({ interventions: 3, totalCost: 40500, averageCost: 13500 });
  }, 30_000);

  it("renvoie null et non 0 sans donnée sur la période", async () => {
    const empty = { from: "2018-01-01", to: "2018-01-31" };
    expect(await kpiService.incidentsPerMonth(empty)).toEqual([]);
    expect(await kpiService.preventiveCompliance(empty)).toEqual({ planned: 0, doneOnTime: 0, rate: null });
    expect(await kpiService.avgCostPerIntervention(empty)).toEqual({
      interventions: 0, totalCost: 0, averageCost: null,
    });
  }, 30_000);
});
