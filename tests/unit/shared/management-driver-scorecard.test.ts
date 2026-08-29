import { describe, expect, it } from "vitest";
import {
  buildManagementDriverScorecard,
  buildManagementDriverScorecardItem,
  computeConsumptionScore,
  computeDriverOverallScore,
  computeIncidentScore,
  computeMissionConsumptionL100,
  extractMissionActualDeliveryDate,
  isMissionDeliveryOnTime,
  parseMissionOrderNumberFromAlertMessage,
} from "@shared/constants/management-driver-scorecard";

describe("computeMissionConsumptionL100", () => {
  it("calcule L/100 km à partir des litres et km réels", () => {
    expect(computeMissionConsumptionL100(260, 1000)).toBe(26);
  });

  it("retourne null si données manquantes", () => {
    expect(computeMissionConsumptionL100(null, 1000)).toBeNull();
    expect(computeMissionConsumptionL100(100, 0)).toBeNull();
  });
});

describe("computeConsumptionScore", () => {
  it("donne 100 si le chauffeur est à la médiane ou en dessous", () => {
    expect(computeConsumptionScore(24, 26)).toBe(100);
    expect(computeConsumptionScore(26, 26)).toBe(100);
  });

  it("pénalise une surconsommation progressive", () => {
    expect(computeConsumptionScore(33.8, 26)).toBeCloseTo(0, 5);
    expect(computeConsumptionScore(29.9, 26)).toBeGreaterThan(0);
  });
});

describe("isMissionDeliveryOnTime", () => {
  it("accepte un retard dans la tolérance corridor", () => {
    const planned = new Date("2026-08-01T12:00:00Z");
    const actual = new Date("2026-08-01T15:00:00Z");
    expect(isMissionDeliveryOnTime(planned, actual)).toBe(true);
  });

  it("marque en retard au-delà de la tolérance", () => {
    const planned = new Date("2026-08-01T12:00:00Z");
    const actual = new Date("2026-08-02T12:00:00Z");
    expect(isMissionDeliveryOnTime(planned, actual)).toBe(false);
  });
});

describe("computeIncidentScore", () => {
  it("retire 25 points par incident", () => {
    expect(computeIncidentScore(0)).toBe(100);
    expect(computeIncidentScore(2)).toBe(50);
    expect(computeIncidentScore(5)).toBe(0);
  });
});

describe("computeDriverOverallScore", () => {
  it("pondère consommation, ponctualité et incidents", () => {
    const score = computeDriverOverallScore(80, 90, 100);
    expect(score).toBeCloseTo(88, 5);
  });

  it("renormalise si une dimension manque", () => {
    const score = computeDriverOverallScore(null, 80, 100);
    expect(score).toBeCloseTo(86.67, 1);
  });
});

describe("extractMissionActualDeliveryDate", () => {
  it("lit execution.actualDeliveryDate", () => {
    const date = extractMissionActualDeliveryDate({
      execution: { actualDeliveryDate: "2026-08-10T08:00:00.000Z" },
    });
    expect(date?.toISOString()).toBe("2026-08-10T08:00:00.000Z");
  });
});

describe("parseMissionOrderNumberFromAlertMessage", () => {
  it("extrait le numéro de commande mission", () => {
    expect(parseMissionOrderNumberFromAlertMessage("[Mission BL-2026-001] Accident")).toBe(
      "BL-2026-001",
    );
  });
});

describe("buildManagementDriverScorecard", () => {
  it("classe top performers et chauffeurs à surveiller", () => {
    const good = buildManagementDriverScorecardItem({
      driverId: 1,
      driverName: "Jean Dupont",
      fleetMedianConsumptionL100: 26,
      incidentCount: 0,
      missions: [
        {
          missionId: 1,
          actualFuelQuantity: 260,
          actualDistance: 1000,
          plannedDeliveryAt: new Date("2026-08-01T12:00:00Z"),
          actualDeliveryAt: new Date("2026-08-01T13:00:00Z"),
        },
      ],
    });
    const weak = buildManagementDriverScorecardItem({
      driverId: 2,
      driverName: "Paul Martin",
      fleetMedianConsumptionL100: 26,
      incidentCount: 2,
      missions: [
        {
          missionId: 2,
          actualFuelQuantity: 400,
          actualDistance: 1000,
          plannedDeliveryAt: new Date("2026-08-01T12:00:00Z"),
          actualDeliveryAt: new Date("2026-08-03T12:00:00Z"),
        },
      ],
    });

    const result = buildManagementDriverScorecard([good, weak]);
    expect(result.summary.driverCount).toBe(2);
    expect(result.topPerformers[0]?.driverId).toBe(1);
    expect(result.needsAttention.some((item) => item.driverId === 2)).toBe(true);
    expect(result.allScored).toHaveLength(2);
  });
});
