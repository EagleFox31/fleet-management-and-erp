import { afterEach, describe, expect, it } from "vitest";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestFuelRecord,
  createTestUser,
  createTestVehicle,
} from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.fuelRecordIds.length = 0;
});

describe("FuelCardService", () => {
  it("getCurrentBalance : crédits - débits = solde", async () => {
    const result = await fuelCardService.getCurrentBalance();
    expect(result.balance).toBeCloseTo(result.totalCredits - result.totalDebits, 0);
    expect(result.averagePricePerLiter).toBeGreaterThan(0);
  });

  it("getFuelHistory filtre les crédits factory", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const credit = await createTestFuelRecord({
      createdBy: user.id,
      creditAmount: "50000.00",
      debitAmount: "0",
      quantity: 0,
      year: 2026,
      month: 1,
      date: "2026-01-20",
    });
    ids.fuelRecordIds.push(credit.id);

    const credits = await fuelCardService.getFuelHistory({
      year: 2026,
      month: 1,
      type: "credit",
    });
    expect(credits.some((row) => row.id === credit.id)).toBe(true);
  });

  it("getConsumptionStatsByVehicle utilise le véhicule factory", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const record = await createTestFuelRecord({
      vehicleId: vehicle.id,
      debitAmount: "82800.00",
      creditAmount: "0",
      quantity: 100,
    });
    ids.fuelRecordIds.push(record.id);

    const result = await fuelCardService.getConsumptionStatsByVehicle(vehicle.id);
    expect(result.vehicleId).toBe(vehicle.id);
    expect(result.recordsCount).toBeGreaterThanOrEqual(1);
    expect(result.totalLiters).toBeGreaterThanOrEqual(100);
  });

  it("detectAnomalies sans assez d'historique ne invente pas d'anomalie", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    const result = await fuelCardService.detectAnomalies(vehicle.id);
    expect(result.hasAnomaly).toBe(false);
    expect(result.anomalies).toEqual([]);
  });

  it("getMonthlyStats : solde = crédits - débits", async () => {
    const result = await fuelCardService.getMonthlyStats(2026, 1);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(1);
    expect(result.balance).toBeCloseTo(result.totalCredits - result.totalDebits, 0);
  });

  it("pleins simultanés ne font pas passer le solde sous zéro", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    // Le solde est une somme sur toute la table : on le ramène à 1 000 FCFA
    // par une écriture d'ajustement, quel que soit l'état de la base de test.
    const target = 1_000;
    const { balance: before } = await fuelCardService.getCurrentBalance();
    const delta = target - before;
    if (Math.abs(delta) > 0.001) {
      const adjust = await createTestFuelRecord({
        createdBy: user.id,
        creditAmount: delta > 0 ? delta.toFixed(2) : "0",
        debitAmount: delta < 0 ? (-delta).toFixed(2) : "0",
        cost: "0",
        quantity: 0,
      });
      ids.fuelRecordIds.push(adjust.id);
    }
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(target, 2);

    // Connexions du pool ouvertes d'avance : sans cela, l'ouverture d'une
    // connexion décale le second plein et masque la course.
    await Promise.all(Array.from({ length: 4 }, () => fuelCardService.getCurrentBalance()));

    // Pleins simultanés de 600 FCFA chacun : un seul tient dans le solde.
    const fill = () =>
      fuelCardService.recordConsumption({
        vehicleId: vehicle.id,
        quantity: 6,
        unitPrice: 100,
        date: "2026-01-15",
        stationName: "TEST-Station",
        destination: "TEST-Concurrence",
        userId: user.id,
      });
    const results = await Promise.allSettled([fill(), fill(), fill()]);

    for (const r of results) {
      if (r.status === "fulfilled") ids.fuelRecordIds.push(r.value.consumption.id);
    }
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(target - 600, 2);
    // Trois transactions sérialisées par le verrou : 5 s par défaut ne tient pas sous charge.
  }, 30_000);
});
