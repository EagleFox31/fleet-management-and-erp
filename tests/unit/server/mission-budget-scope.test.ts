import { describe, expect, it } from "vitest";
import { canReadMissionBudget, omitMissionBudget, redactMissionBudget } from "../../../server/lib/mission-budget-scope";

const mission = () => ({
  id: 1,
  status: "assigned",
  estimatedFuelCost: "123457",
  createdAt: new Date("2026-11-05T00:00:00.000Z"),
  workflowData: { budgetPlan: { fuelBudget: 234567 }, execution: { startedAt: null } },
  assignment: { id: 3, driverId: 9 },
});

describe("redactMissionBudget (Q19)", () => {
  it("lecteurs du budget : réponse inchangée (même référence)", () => {
    for (const role of ["admin", "logistics", "management", "secretary"]) {
      const value = mission();
      expect(redactMissionBudget({ role }, value)).toBe(value);
      expect(canReadMissionBudget({ role })).toBe(true);
    }
  });

  it("technicien, chauffeur, client, lecteur absent : montants à null, clés présentes, reste intact", () => {
    for (const reader of [{ role: "technician" }, { role: "driver" }, { role: "client" }, null, undefined]) {
      const value = mission();
      const out = redactMissionBudget(reader, value);
      expect(out.estimatedFuelCost).toBeNull();
      expect(out.workflowData).toEqual({ budgetPlan: null, execution: { startedAt: null } });
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.assignment).toEqual({ id: 3, driverId: 9 });
      expect(value.estimatedFuelCost).toBe("123457");
    }
  });

  it("liste et totaux carburant imbriqués", () => {
    const out = redactMissionBudget({ role: "technician" }, {
      list: [mission(), mission()],
      totals: { totalCost: 10, estimatedBudget: 345678, budgetDelta: -345668 },
    });
    const sent = JSON.stringify(out);
    for (const sentinel of ["123457", "234567", "345678", "345668"]) expect(sent).not.toContain(sentinel);
    expect(out.totals.totalCost).toBe(10);
  });

  it("omitMissionBudget : clés retirées, pas mises à null", () => {
    const out = omitMissionBudget(mission()) as Record<string, any>;
    expect("estimatedFuelCost" in out).toBe(false);
    expect("budgetPlan" in out.workflowData).toBe(false);
    expect(out.workflowData.execution).toEqual({ startedAt: null });
  });

  it("statistiques d'opérations : revenu et marge à null hors lecteurs, compteurs conservés", () => {
    const stats = () => [
      { clientName: "C", missionCount: 1, totalDistance: 120, totalRevenue: 987654, totalFuelCost: 1000, margin: 986654, marginPercentage: 99.9 },
    ];
    const hidden = redactMissionBudget({ role: "technician" }, stats()) as Record<string, any>[];
    expect(hidden[0]).toEqual({ clientName: "C", missionCount: 1, totalDistance: 120, totalRevenue: null, totalFuelCost: 1000, margin: null, marginPercentage: null });

    const reader = stats();
    expect(redactMissionBudget({ role: "logistics" }, reader)).toBe(reader);

    const omitted = (omitMissionBudget(stats()) as Record<string, any>[])[0];
    for (const key of ["totalRevenue", "margin", "marginPercentage"]) expect(key in omitted).toBe(false);
    expect(omitted.missionCount).toBe(1);
  });

  it("une marge hors statistique d'opérations n'est pas touchée", () => {
    const value = { margin: 12, label: "x" };
    expect(redactMissionBudget({ role: "technician" }, value)).toEqual({ margin: 12, label: "x" });
  });
});
