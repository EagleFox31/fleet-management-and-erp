import { describe, expect, it } from "vitest";
import {
  buildManagementMissionProfitability,
  buildMissionProfitabilityItem,
  computeMissionMaintenanceShareHT,
  computeMissionMarginHT,
  extractMissionActualRoadExpensesHT,
  mergeMissionActualFdrCost,
  resolveMissionFuelCostHT,
  sumMissionActualRoadExpensesHT,
} from "@shared/constants/management-mission-profitability";

describe("extractMissionActualRoadExpensesHT", () => {
  it("lit les FDR réels post-mission dans workflowData", () => {
    expect(
      extractMissionActualRoadExpensesHT({
        costs: { actualFdrCost: 45000 },
      }),
    ).toBe(45_000);
  });

  it("retourne null si seul le budget FDR est renseigné", () => {
    expect(
      extractMissionActualRoadExpensesHT({
        budgetPlan: { roadExpensesBudget: 50000 },
      }),
    ).toBeNull();
  });

  it("accepte un FDR réel à zéro", () => {
    expect(
      extractMissionActualRoadExpensesHT({
        costs: { actualFdrCost: 0 },
      }),
    ).toBe(0);
  });
});

describe("sumMissionActualRoadExpensesHT", () => {
  it("somme les FDR réels et compte les missions manquantes", () => {
    const result = sumMissionActualRoadExpensesHT([
      { workflowData: { costs: { actualFdrCost: 10000 } } },
      { workflowData: { costs: { actualFdrCost: 5000 } } },
      { workflowData: { budgetPlan: { roadExpensesBudget: 8000 } } },
    ]);

    expect(result.totalHT).toBe(15_000);
    expect(result.missionCount).toBe(2);
    expect(result.missingCount).toBe(1);
  });
});

describe("mergeMissionActualFdrCost", () => {
  it("persiste actualFdrCost dans workflowData.costs", () => {
    const merged = mergeMissionActualFdrCost({ budgetPlan: { roadExpensesBudget: 50000 } }, 42000);
    expect(merged.costs).toMatchObject({ actualFdrCost: 42000 });
  });
});

describe("resolveMissionFuelCostHT", () => {
  it("privilégie actualFuelCost mission", () => {
    expect(resolveMissionFuelCostHT("120000", 80000)).toBe(120_000);
  });
});

describe("computeMissionMaintenanceShareHT", () => {
  it("applique le CPK période sur les km réels", () => {
    expect(computeMissionMaintenanceShareHT(350, 1000)).toBe(350_000);
  });

  it("retourne 0 sans km réel", () => {
    expect(computeMissionMaintenanceShareHT(350, null)).toBe(0);
  });
});

describe("buildMissionProfitabilityItem", () => {
  it("calcule la marge HT mission", () => {
    const item = buildMissionProfitabilityItem({
      missionId: 1,
      orderNumber: "ORD-001",
      clientName: "MAERSK",
      destination: "NDJAMENA",
      workflowData: { costs: { actualFdrCost: 20000 } },
      actualFuelCost: "80000",
      actualDistance: 500,
      fuelRecordsTotal: 0,
      revenueHT: 200000,
      cpkMaintenanceFcfPerKm: 100,
    });

    expect(item.fuelHT).toBe(80_000);
    expect(item.roadExpensesHT).toBe(20_000);
    expect(item.maintenanceShareHT).toBe(50_000);
    expect(item.marginHT).toBe(50_000);
    expect(item.marginPercent).toBe(25);
    expect(item.missingFields).not.toContain("roadExpenses");
  });

  it("signale les FDR manquants sans utiliser le budget", () => {
    const item = buildMissionProfitabilityItem({
      missionId: 2,
      orderNumber: "ORD-002",
      clientName: "AGL",
      destination: "DOUALA",
      workflowData: { budgetPlan: { roadExpensesBudget: 30000 } },
      actualFuelCost: "50000",
      actualDistance: 200,
      fuelRecordsTotal: 0,
      revenueHT: 100000,
      cpkMaintenanceFcfPerKm: 50,
    });

    expect(item.roadExpensesHT).toBeNull();
    expect(item.missingFields).toContain("roadExpenses");
    expect(item.hasIncompleteCosts).toBe(true);
  });
});

describe("buildManagementMissionProfitability", () => {
  it("classe les missions rentables et déficitaires", () => {
    const profitable = buildMissionProfitabilityItem({
      missionId: 1,
      orderNumber: "A",
      clientName: "Client A",
      destination: "L1",
      workflowData: { costs: { actualFdrCost: 10000 } },
      actualFuelCost: "20000",
      actualDistance: 100,
      fuelRecordsTotal: 0,
      revenueHT: 100000,
      cpkMaintenanceFcfPerKm: 10,
    });
    const deficit = buildMissionProfitabilityItem({
      missionId: 2,
      orderNumber: "B",
      clientName: "Client B",
      destination: "L2",
      workflowData: { costs: { actualFdrCost: 50000 } },
      actualFuelCost: "120000",
      actualDistance: 800,
      fuelRecordsTotal: 0,
      revenueHT: 100000,
      cpkMaintenanceFcfPerKm: 100,
    });

    const result = buildManagementMissionProfitability([profitable, deficit]);

    expect(result.summary.analyzedCount).toBe(2);
    expect(result.summary.profitableCount).toBe(1);
    expect(result.summary.deficitCount).toBe(1);
    expect(result.topProfitable[0]?.orderNumber).toBe("A");
    expect(result.worstDeficit[0]?.orderNumber).toBe("B");
  });
});

describe("computeMissionMarginHT", () => {
  it("soustrait carburant, FDR et quote-part maintenance du CA HT", () => {
    expect(computeMissionMarginHT(300_000, 80_000, 20_000, 50_000)).toBe(150_000);
  });
});
