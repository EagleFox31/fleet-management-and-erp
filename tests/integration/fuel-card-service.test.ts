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
});
