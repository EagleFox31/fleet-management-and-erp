import type { FuelAnomalyRule } from "../contracts/fuel-anomalies";

/** Libellés métier des règles d'anomalie carburant : source unique (client et serveur). */
export const FUEL_ANOMALY_RULE_LABELS: Record<FuelAnomalyRule, string> = {
  "consumption-gap": "Plein anormalement élevé",
  "tank-overflow": "Plein supérieur au réservoir",
  "odometer-regression": "Kilométrage en recul",
};

export function getFuelAnomalyRuleLabel(rule: string): string {
  return FUEL_ANOMALY_RULE_LABELS[rule as FuelAnomalyRule] ?? "Anomalie";
}
