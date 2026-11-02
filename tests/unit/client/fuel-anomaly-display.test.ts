import { describe, expect, it } from "vitest";
import { formatFuelAnomalyFigures } from "@/lib/fuel-anomaly-display";
import { FUEL_ANOMALY_RULES, type FuelAnomaly } from "@shared/contracts/fuel-anomalies";
import { FUEL_ANOMALY_RULE_LABELS } from "@shared/constants/fuel-anomaly-rules";

const base: FuelAnomaly = {
  anomalyKey: "consumption-gap:1", rule: "consumption-gap", fuelRecordId: 1, date: null, vehicleId: 1,
  vehicleLabel: null, quantity: 80, averageQuantity: 40, threshold: 60, status: "open", comment: null, resolvedAt: null,
};

describe("formatFuelAnomalyFigures", () => {
  it("consumption-gap en litres", () => {
    const f = formatFuelAnomalyFigures(base);
    expect(f.value).toContain("L");
    expect(f.reference).toMatch(/Moyenne.*L.*seuil.*L/);
  });
  it("tank-overflow compare à la capacité et affiche le seuil toléré", () => {
    const f = formatFuelAnomalyFigures({ ...base, rule: "tank-overflow", averageQuantity: 70, threshold: 73.5, tankCapacityL: 70 });
    expect(f.reference).toBe(`Réservoir : 70 L, seuil : ${(73.5).toLocaleString("fr-FR")} L`);
  });
  it("odometer-regression en km, jamais en L", () => {
    const f = formatFuelAnomalyFigures({ ...base, rule: "odometer-regression", mileage: 98000, previousMileage: 98500, averageQuantity: 98500, threshold: 98500 });
    expect(f.value).toMatch(/km$/);
    expect(f.reference).toMatch(/km$/);
    expect(`${f.value}${f.reference}`).not.toMatch(/ L/);
  });
  it("chaque règle a un libellé", () => {
    for (const r of FUEL_ANOMALY_RULES) expect(FUEL_ANOMALY_RULE_LABELS[r]).toBeTruthy();
  });
});
