import { describe, expect, it } from "vitest";
import {
  buildManagementExecutiveKpis,
  computeAverageDowntimeHours,
  computeCpkMaintenanceFcfPerKm,
  computePrkDirectChargesHT,
  computePrkFcfPerKm,
} from "@shared/constants/management-executive-kpis";

describe("computePrkFcfPerKm", () => {
  it("retourne null si aucun kilomètre réel", () => {
    expect(computePrkFcfPerKm(500_000, 0)).toBeNull();
  });

  it("calcule le PRK en FCFA/km", () => {
    expect(computePrkFcfPerKm(1_280_000, 1_000)).toBe(1_280);
  });
});

describe("computePrkDirectChargesHT", () => {
  it("n'inclut pas les coûts de pose pneu (déjà dans les factures fournisseurs)", () => {
    expect(
      computePrkDirectChargesHT({
        fuelHT: 800_000,
        maintenanceHT: 200_000,
        suppliersHT: 150_000,
      }),
    ).toBe(1_150_000);
  });
});

describe("computeCpkMaintenanceFcfPerKm", () => {
  it("additionne maintenance et achats pneus fournisseur avant division", () => {
    expect(computeCpkMaintenanceFcfPerKm(300_000, 50_000, 1_000)).toBe(350);
  });
});

describe("computeAverageDowntimeHours", () => {
  it("convertit les minutes en heures moyennes par OT", () => {
    expect(computeAverageDowntimeHours(720, 3)).toBe(4);
  });

  it("retourne null sans OT terminé", () => {
    expect(computeAverageDowntimeHours(120, 0)).toBeNull();
  });
});

describe("buildManagementExecutiveKpis", () => {
  it("agrège PRK, CPK et downtime sans double comptage pneus", () => {
    const result = buildManagementExecutiveKpis({
      totalKm: 2_000,
      missionCount: 8,
      missionsExcludedMissingKm: 4,
      eligibleMissionCount: 12,
      fuelHT: 800_000,
      maintenanceHT: 200_000,
      suppliersHT: 100_000,
      tireSupplierHT: 50_000,
      downtimeMinutes: 1_440,
      completedWorkOrders: 4,
      vehiclesImmobilizedOver48h: 2,
    });

    expect(result.prk.fcfPerKm).toBe(550);
    expect(result.prk.directChargesHT).toBe(1_100_000);
    expect(result.prk.missionsExcludedMissingKm).toBe(4);
    expect(result.cpkMaintenance.fcfPerKm).toBe(125);
    expect(result.downtime.totalImmobilizationHours).toBe(24);
    expect(result.downtime.averageHoursPerCompletedOrder).toBe(6);
    expect(result.vehiclesImmobilizedOver48h).toBe(2);
  });
});
