import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { findPlanningClash, overlaps } from "../../server/services/mission-planning";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/** findPlanningClash : règle unique de conflit de planning (chauffeur ou véhicule, missions actives). */
const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const day = (d: number) => new Date(Date.UTC(2033, 0, d, 8, 0, 0));

async function fixture(status: string, assignmentStatus = "pending") {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [d] = await db.insert(drivers).values({ firstName: "TEST", lastName: uniqueTestToken("drv") } as any).returning();
  driverIds.push(d.id);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MPC"), pickupAddress: "A", deliveryAddress: "B", pickupDate: day(10), deliveryDate: day(12), status } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId: d.id, status: assignmentStatus } as any);
  return { vehicleId: v.id, driverId: d.id, mission: m };
}

afterAll(async () => {
  if (missionIds.length) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
});

describe("findPlanningClash", { timeout: 60_000 }, () => {
  it("chevauchement : conflit côté chauffeur, puis côté véhicule", async () => {
    const f = await fixture("assigned");
    const other = (await fixture("completed")).vehicleId;
    const asDriver = await findPlanningClash(db, { missionId: null, pickupDate: day(11), deliveryDate: day(13), vehicleId: other, driverId: f.driverId });
    expect(asDriver).toMatchObject({ kind: "driver", orderNumber: f.mission.orderNumber });
    const otherDriver = (await fixture("completed")).driverId;
    const asVehicle = await findPlanningClash(db, { missionId: null, pickupDate: day(11), deliveryDate: day(13), vehicleId: f.vehicleId, driverId: otherDriver });
    expect(asVehicle).toMatchObject({ kind: "vehicle" });
  });

  it("bords inclus : fin de l'une = début de l'autre est un conflit ; un jour d'écart n'en est pas un", async () => {
    const f = await fixture("planned");
    const q = { missionId: null, vehicleId: f.vehicleId, driverId: f.driverId };
    expect(await findPlanningClash(db, { ...q, pickupDate: day(12), deliveryDate: day(14) })).not.toBeNull();
    expect(await findPlanningClash(db, { ...q, pickupDate: day(13), deliveryDate: day(14) })).toBeNull();
  });

  it("ignore sa propre mission, les missions terminées ou annulées et les affectations annulées", async () => {
    const own = await fixture("assigned");
    const q = { pickupDate: day(10), deliveryDate: day(12), vehicleId: own.vehicleId, driverId: own.driverId };
    expect(await findPlanningClash(db, { ...q, missionId: own.mission.id })).toBeNull();
    for (const status of ["completed", "cancelled", "delivered"]) {
      const f = await fixture(status);
      expect(await findPlanningClash(db, { ...q, missionId: null, vehicleId: f.vehicleId, driverId: f.driverId })).toBeNull();
    }
    const voided = await fixture("assigned", "cancelled");
    expect(await findPlanningClash(db, { ...q, missionId: null, vehicleId: voided.vehicleId, driverId: voided.driverId })).toBeNull();
  });

  it("dates absentes : pas de conflit détectable", async () => {
    const f = await fixture("assigned");
    expect(await findPlanningClash(db, { missionId: null, pickupDate: null, deliveryDate: day(12), vehicleId: f.vehicleId, driverId: f.driverId })).toBeNull();
    expect(overlaps(null, day(1), day(1), day(2))).toBe(false);
  });
});
