import { describe, expect, it } from "vitest";
import {
  buildManagementVehicleTco,
  buildManagementVehicleTcoItem,
  computeVehiclePeriodCostsHT,
  computeVehiclePeriodMarginHT,
} from "@shared/constants/management-vehicle-tco";

describe("management-vehicle-tco", () => {
  it("additionne carburant et maintenance pour les coûts période", () => {
    expect(computeVehiclePeriodCostsHT(120_000, 45_000)).toBe(165_000);
  });

  it("calcule la marge opérationnelle HT", () => {
    expect(computeVehiclePeriodMarginHT(500_000, 165_000)).toBe(335_000);
  });

  it("construit un item véhicule avec coûts et marge dérivés", () => {
    const item = buildManagementVehicleTcoItem({
      vehicleId: 1,
      registrationNumber: "LT-123-AA",
      brand: "Volvo",
      model: "FH16",
      acquisitionHT: 45_000_000,
      periodFuelHT: 800_000,
      periodMaintenanceHT: 200_000,
      revenueHT: 1_500_000,
      missionCount: 3,
    });

    expect(item.periodCostsHT).toBe(1_000_000);
    expect(item.periodMarginHT).toBe(500_000);
    expect(item.missionCount).toBe(3);
  });

  it("agrège le TCO flotte et classe top / pire marge", () => {
    const profitable = buildManagementVehicleTcoItem({
      vehicleId: 1,
      registrationNumber: "A",
      brand: "Volvo",
      model: "FH",
      acquisitionHT: 0,
      periodFuelHT: 100_000,
      periodMaintenanceHT: 50_000,
      revenueHT: 300_000,
      missionCount: 2,
    });
    const deficit = buildManagementVehicleTcoItem({
      vehicleId: 2,
      registrationNumber: "B",
      brand: "Scania",
      model: "R",
      acquisitionHT: 0,
      periodFuelHT: 400_000,
      periodMaintenanceHT: 100_000,
      revenueHT: 200_000,
      missionCount: 1,
    });
    const idle = buildManagementVehicleTcoItem({
      vehicleId: 3,
      registrationNumber: "C",
      brand: "Man",
      model: "TGX",
      acquisitionHT: 10_000_000,
      periodFuelHT: 0,
      periodMaintenanceHT: 0,
      revenueHT: 0,
      missionCount: 0,
    });

    const result = buildManagementVehicleTco([profitable, deficit, idle], {
      fleetInsuranceHT: 250_000,
      missionsWithoutRevenueAttribution: 1,
    });

    expect(result.summary.vehicleCount).toBe(3);
    expect(result.summary.totalRevenueHT).toBe(500_000);
    expect(result.summary.totalPeriodCostsHT).toBe(650_000);
    expect(result.summary.totalPeriodMarginHT).toBe(-150_000);
    expect(result.summary.fleetInsuranceHT).toBe(250_000);
    expect(result.summary.missionsWithoutRevenueAttribution).toBe(1);
    expect(result.topByMargin).toHaveLength(1);
    expect(result.topByMargin[0]?.registrationNumber).toBe("A");
    expect(result.worstByMargin).toHaveLength(1);
    expect(result.worstByMargin[0]?.registrationNumber).toBe("B");
  });
});
