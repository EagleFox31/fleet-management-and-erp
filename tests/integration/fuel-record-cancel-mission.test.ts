import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { FuelService } from "../../server/services/fuel-service";
import { settleMissionBudget } from "../../server/services/mission-budgets-service";
import { fuelRecords, missionBudgets, missions } from "../../shared/schema";
import { FUEL_RECORD_BUDGET_SETTLED_MESSAGE } from "../../shared/constants/fuel-record-cancel";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle } from "../support/factories";
import { deleteFuelRecordsWhere } from "../support/money-override";
import { uniqueTestToken } from "../support/ids";

/**
 * Annulation d'un plein validé de mission : le trigger de fuel_records recalcule le réel de la
 * mission (litres et coût), et un budget soldé refuse l'annulation sans rien écrire.
 */
const ids = createIdBag();
const missionIds: number[] = [];
const service = new FuelService();

async function missionWithRecord(debit: string, quantity: number) {
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("CANCEL"), pickupAddress: "TEST A", deliveryAddress: "TEST B" })
    .returning();
  missionIds.push(mission.id);
  const record = await createTestFuelRecord({ vehicleId: vehicle.id, debitAmount: debit, cost: debit, quantity });
  ids.fuelRecordIds.push(record.id);
  await db.update(fuelRecords).set({ missionId: mission.id, validationStatus: "validated" }).where(eq(fuelRecords.id, record.id));
  return { admin, mission, record };
}

const missionRow = async (id: number) => (await db.select().from(missions).where(eq(missions.id, id)))[0];

afterAll(async () => {
  if (missionIds.length) await db.delete(missionBudgets).where(inArray(missionBudgets.missionId, missionIds));
  if (ids.vehicleIds.length) await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  await cleanupCreated(ids);
  if (missionIds.length) await db.delete(missions).where(inArray(missions.id, missionIds));
}, 120000);

describe("annulation d'un plein de mission", { timeout: 120000 }, () => {
  it("le réel de la mission est recalculé sans le plein annulé", async () => {
    const { admin, mission, record } = await missionWithRecord("3000.00", 4);
    const before = await missionRow(mission.id);
    expect(Number(before.actualFuelCost)).toBe(3000);
    expect(Number(before.actualFuelQuantity)).toBe(4);

    const result = await service.cancelFuelRecord(record.id, { id: admin.id, role: "admin" }, "Plein saisi deux fois");
    expect(result?.replayed).toBe(false);

    const after = await missionRow(mission.id);
    expect(Number(after.actualFuelCost)).toBe(0);
    expect(Number(after.actualFuelQuantity)).toBe(0);
  });

  it("budget de la mission soldé : 409, plein et réel intacts", async () => {
    const { admin, mission, record } = await missionWithRecord("2000.00", 3);
    await db.insert(missionBudgets).values({
      missionId: mission.id,
      budgetDate: "2026-11-10",
      fuelLiters: "3",
      fuelUnitPrice: "700",
      fuelAmount: "2100",
      fdrAmount: "0",
      totalAmount: "2100",
      status: "disbursed",
      settledAt: new Date(),
    });

    await expect(service.cancelFuelRecord(record.id, { id: admin.id, role: "admin" }, "Trop tard")).rejects.toMatchObject({
      status: 409,
      message: FUEL_RECORD_BUDGET_SETTLED_MESSAGE,
    });
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.deletedAt).toBeNull();
    expect(row.cancellationReason).toBeNull();
    expect(Number((await missionRow(mission.id)).actualFuelCost)).toBe(2000);
  });

  it("solde du budget et annulation en parallèle : l'un des deux passe seul, jamais budget soldé et plein annulé sans 409", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { admin, mission, record } = await missionWithRecord("1500.00", 2);
      await db.update(missions).set({ status: "completed" }).where(eq(missions.id, mission.id));
      const [budget] = await db
        .insert(missionBudgets)
        .values({
          missionId: mission.id,
          budgetDate: "2026-11-10",
          fuelLiters: "2",
          fuelUnitPrice: "750",
          fuelAmount: "1500",
          fdrAmount: "0",
          totalAmount: "1500",
          status: "disbursed",
        })
        .returning();

      const [cancelled, settled] = await Promise.allSettled([
        service.cancelFuelRecord(record.id, { id: admin.id, role: "admin" }, "Course avec le solde"),
        settleMissionBudget(budget.id, admin.id),
      ]);

      const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
      const [after] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, budget.id));
      const cancelOk = cancelled.status === "fulfilled";
      if (!cancelOk) expect(cancelled.reason).toMatchObject({ status: 409, message: FUEL_RECORD_BUDGET_SETTLED_MESSAGE });
      // Invariant : un plein annulé sans 409 implique l'annulation passée avant le solde, jamais après.
      expect(row.deletedAt !== null).toBe(cancelOk);
      expect(settled.status === "rejected" ? String((settled.reason as Error).message) : "ok").toBe("ok");
      expect(after.settledAt).not.toBeNull();
    }
  });
});
