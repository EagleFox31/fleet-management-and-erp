import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { FuelService } from "../../server/services/fuel-service";
import { fuelRecords } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle } from "../support/factories";
import { expectWaitsForLock, holdsAdvisoryLock } from "../support/fuel-card-lock";
import { uniqueTestToken } from "../support/ids";

/**
 * Toute écriture touchant debit_amount / credit_amount prend le verrou de la carte
 * carburant (docs/analysis/LESSONS_LEARNED.md, « Carte carburant : contrôle du solde
 * hors transaction »). Preuve directe : une transaction de test tient le verrou, et
 * l'écriture doit attendre sa libération au lieu de passer à côté.
 */

const ids = createIdBag();
const fuelService = new FuelService();

afterEach(async () => {
  // Un plein créé par un test en échec n'est pas dans le sac : il bloquerait la suppression du véhicule.
  if (ids.vehicleIds.length > 0) {
    await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  }
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.fuelRecordIds.length = 0;
});

async function newVehicle() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

describe("verrou de la carte carburant : écritures génériques", { timeout: 30000 }, () => {
  it("createFuelRecord attend le verrou", async () => {
    const vehicle = await newVehicle();
    const created = await expectWaitsForLock(() =>
      fuelService.createFuelRecord({
        vehicleId: vehicle.id,
        date: "2026-01-15",
        quantity: 1,
        cost: "100",
        debitAmount: "100",
        creditAmount: "0",
        notes: uniqueTestToken("lock-create"),
      } as Parameters<FuelService["createFuelRecord"]>[0]),
    );
    ids.fuelRecordIds.push(created.id);
    expect(created.id).toBeGreaterThan(0);
  });

  it("updateFuelRecord attend le verrou", async () => {
    const record = await createTestFuelRecord({ vehicleId: (await newVehicle()).id });
    ids.fuelRecordIds.push(record.id);
    const updated = await expectWaitsForLock(() => fuelService.updateFuelRecord(record.id, { debitAmount: "1" }));
    expect(updated?.debitAmount).toBe("1.00");
  });

  it("deleteFuelRecord attend le verrou", async () => {
    const record = await createTestFuelRecord({ vehicleId: (await newVehicle()).id });
    ids.fuelRecordIds.push(record.id);
    expect(await expectWaitsForLock(() => fuelService.deleteFuelRecord(record.id))).toBe(true);
    expect(await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id))).toHaveLength(0);
  });
});

describe("recordConsumption : écriture liée dans la même transaction", { timeout: 30000 }, () => {
  it("un échec de l'écriture liée annule le débit", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const vehicle = await newVehicle();

    // Solde suffisant quel que soit l'état de la base de test.
    const { balance: before } = await fuelCardService.getCurrentBalance();
    const credit = await createTestFuelRecord({
      createdBy: user.id,
      creditAmount: (Math.max(0, -before) + 1_000).toFixed(2),
      debitAmount: "0",
      cost: "0",
      quantity: 0,
    });
    ids.fuelRecordIds.push(credit.id);
    const balanceBefore = (await fuelCardService.getCurrentBalance()).balance;

    const marker = uniqueTestToken("lock-rollback");
    await expect(
      fuelCardService.recordConsumption(
        {
          vehicleId: vehicle.id,
          quantity: 1,
          unitPrice: 100,
          date: "2026-01-15",
          stationName: "TEST-Station",
          destination: "TEST-Rollback",
          notes: marker,
          userId: user.id,
        },
        async () => {
          throw new Error("journal de régularisation indisponible");
        },
      ),
    ).rejects.toThrow("journal de régularisation indisponible");

    const leaked = await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicle.id));
    for (const row of leaked) ids.fuelRecordIds.push(row.id);
    expect(leaked).toHaveLength(0);
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(balanceBefore, 2);
  });

  it("un rejeu trouvé sous le verrou n'écrit aucun débit et renvoie le plein existant", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const vehicle = await newVehicle();
    const existing = await createTestFuelRecord({ vehicleId: vehicle.id, debitAmount: "200.00", cost: "200.00", quantity: 2 });
    ids.fuelRecordIds.push(existing.id);
    const balanceBefore = (await fuelCardService.getCurrentBalance()).balance;
    let hookCalled = false;
    const lockHeldPerReplay: boolean[] = [];

    const result = await expectWaitsForLock(() =>
      fuelCardService.recordConsumption(
        {
          vehicleId: vehicle.id,
          quantity: 2,
          unitPrice: 100,
          date: "2026-01-15",
          stationName: "TEST-Station",
          destination: "TEST-Rejeu",
          userId: user.id,
        },
        async () => {
          hookCalled = true;
        },
        {
          replay: async (tx) => {
            lockHeldPerReplay.push(await holdsAdvisoryLock(tx));
            return existing;
          },
        },
      ),
    );

    // Un seul appel, et sous le verrou : un rejeu lu avant le verrou pourrait manquer un débit en cours.
    expect(lockHeldPerReplay, "le rejeu doit être lu une fois, sous le verrou de la carte").toEqual([true]);
    expect(result.replayed).toBe(true);
    expect(result.consumption.id).toBe(existing.id);
    expect(result.cost).toBe(200);
    expect(hookCalled).toBe(false);
    expect(await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicle.id))).toHaveLength(1);
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(balanceBefore, 2);
  });
});
