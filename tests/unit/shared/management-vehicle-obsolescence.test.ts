import { describe, expect, it } from "vitest";
import {
  annualizePeriodAmount,
  buildManagementVehicleObsolescence,
  buildManagementVehicleObsolescenceItem,
  computeLinearResidualValueHT,
  computeVehicleAgeYears,
  shouldRecommendVehicleReplacement,
} from "@shared/constants/management-vehicle-obsolescence";

describe("management-vehicle-obsolescence", () => {
  it("calcule l'âge véhicule en années", () => {
    const reference = new Date("2026-01-01T00:00:00Z");
    const purchase = new Date("2021-01-01T00:00:00Z");
    expect(computeVehicleAgeYears(purchase, reference)).toBeCloseTo(5, 0);
  });

  it("amortit linéairement sur 10 ans", () => {
    expect(computeLinearResidualValueHT(50_000_000, 5)).toBe(25_000_000);
    expect(computeLinearResidualValueHT(50_000_000, 12)).toBe(0);
  });

  it("annualise les coûts période", () => {
    expect(annualizePeriodAmount(100_000, 30)).toBeCloseTo(1_216_666.67, 0);
  });

  it("recommande le remplacement si maintenance annualisée > valeur résiduelle", () => {
    expect(
      shouldRecommendVehicleReplacement({
        acquisitionHT: 40_000_000,
        annualizedMaintenanceHT: 6_000_000,
        residualValueHT: 4_000_000,
      }),
    ).toBe(true);

    expect(
      shouldRecommendVehicleReplacement({
        acquisitionHT: 40_000_000,
        annualizedMaintenanceHT: 2_000_000,
        residualValueHT: 8_000_000,
      }),
    ).toBe(false);
  });

  it("agrège les candidats au remplacement", () => {
    const reference = new Date("2026-08-01T00:00:00Z");
    const purchase = new Date("2014-01-01T00:00:00Z");

    const candidate = buildManagementVehicleObsolescenceItem({
      vehicleId: 1,
      registrationNumber: "LT-001",
      brand: "Volvo",
      model: "FH",
      acquisitionHT: 45_000_000,
      purchaseDate: purchase,
      periodMaintenanceHT: 2_000_000,
      periodDays: 30,
      referenceDate: reference,
    });

    const healthy = buildManagementVehicleObsolescenceItem({
      vehicleId: 2,
      registrationNumber: "LT-002",
      brand: "Scania",
      model: "R",
      acquisitionHT: 40_000_000,
      purchaseDate: new Date("2024-01-01T00:00:00Z"),
      periodMaintenanceHT: 100_000,
      periodDays: 30,
      referenceDate: reference,
    });

    const result = buildManagementVehicleObsolescence([candidate, healthy]);
    expect(result.summary.replacementCandidates).toBeGreaterThanOrEqual(1);
    expect(result.candidates.some((item) => item.vehicleId === 1)).toBe(true);
  });
});
