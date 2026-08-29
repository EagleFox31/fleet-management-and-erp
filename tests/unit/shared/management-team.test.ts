import { describe, expect, it } from "vitest";
import {
  buildManagementTeamDecisions,
  buildManagementTeamPoles,
  buildManagementTeamResponse,
} from "@shared/constants/management-team";
import { buildManagementDriverScorecardItem } from "@shared/constants/management-driver-scorecard";
import { buildManagementDriverScorecard } from "@shared/constants/management-driver-scorecard";

describe("buildManagementTeamPoles", () => {
  it("regroupe les comptes app par pôle métier", () => {
    const roleCounts = new Map([
      ["logistics", 2],
      ["secretary", 1],
      ["technician", 4],
      ["warehouse", 1],
    ]);

    const poles = buildManagementTeamPoles(roleCounts);
    const operations = poles.find((pole) => pole.id === "operations");
    const workshop = poles.find((pole) => pole.id === "workshop");

    expect(operations?.appAccountCount).toBe(3);
    expect(workshop?.appAccountCount).toBe(4);
  });
});

describe("buildManagementTeamDecisions", () => {
  it("priorise les alertes critiques CPC et flotte", () => {
    const decisions = buildManagementTeamDecisions({
      cpcGap: 2,
      cpcUrgent: 1,
      driversWithIncidents: 0,
      underperformingDrivers: 0,
      vehiclesOutOfService: 3,
      vehiclesImmobilizedOver48h: 0,
    });

    expect(decisions[0]?.severity).toBe("critical");
    expect(decisions.some((item) => item.id === "cpc-gap")).toBe(true);
    expect(decisions.some((item) => item.id === "fleet-oos")).toBe(true);
  });
});

describe("buildManagementTeamResponse", () => {
  it("assemble effectifs et décisions sans jargon scorecard", () => {
    const driverScorecard = buildManagementDriverScorecard([
      buildManagementDriverScorecardItem({
        driverId: 1,
        driverName: "Jean",
        fleetMedianConsumptionL100: 26,
        incidentCount: 1,
        missions: [
          {
            missionId: 1,
            actualFuelQuantity: 260,
            actualDistance: 1000,
            plannedDeliveryAt: new Date("2026-08-01T12:00:00Z"),
            actualDeliveryAt: new Date("2026-08-03T12:00:00Z"),
          },
        ],
      }),
    ]);

    const response = buildManagementTeamResponse({
      period: "month",
      roleCounts: new Map([["logistics", 2], ["technician", 3]]),
      driversTotal: 10,
      driversActive: 9,
      cpcCompliant: 7,
      cpcGap: 2,
      cpcUrgent: 1,
      driverScorecard,
      vehiclesOutOfService: 1,
      vehiclesImmobilizedOver48h: 0,
    });

    expect(response.summary.appAccounts).toBe(5);
    expect(response.summary.driversField).toBe(10);
    expect(response.decisions.length).toBeGreaterThan(0);
  });
});
