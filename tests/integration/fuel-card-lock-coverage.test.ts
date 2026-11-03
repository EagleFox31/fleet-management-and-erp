import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { lockFuelCard } from "../../server/lib/fuel-card-lock";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { FuelService } from "../../server/services/fuel-service";
import { fuelRecords } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Toute écriture touchant debit_amount / credit_amount prend le verrou de la carte
 * carburant (docs/analysis/LESSONS_LEARNED.md, « Carte carburant : contrôle du solde
 * hors transaction »). Preuve directe : une transaction de test tient le verrou, et
 * l'écriture doit attendre sa libération au lieu de passer à côté.
 */

const ids = createIdBag();
const fuelService = new FuelService();
const BLOCK_WINDOW_MS = 400;

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

function holdFuelCardLock() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let markAcquired!: () => void;
  const acquired = new Promise<void>((resolve) => (markAcquired = resolve));
  const done = db.transaction(async (tx) => {
    await lockFuelCard(tx);
    markAcquired();
    await gate;
  });
  return {
    acquired,
    release: async () => {
      release();
      await done;
    },
  };
}

/** Lance l'écriture pendant que le verrou est tenu ; elle ne doit aboutir qu'après libération. */
async function expectWaitsForLock<T>(write: () => Promise<T>): Promise<T> {
  // Connexions du pool ouvertes d'avance : l'ouverture d'une connexion à froid dépasse la
  // fenêtre d'observation et ferait passer une écriture non verrouillée pour bloquée.
  await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`SELECT 1`)));
  const holder = holdFuelCardLock();
  await holder.acquired;
  let settled = false;
  const pending = write().finally(() => {
    settled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, BLOCK_WINDOW_MS));
    expect(settled, "l'écriture a abouti sans attendre le verrou de la carte").toBe(false);
  } finally {
    await holder.release();
  }
  return pending;
}

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
});
