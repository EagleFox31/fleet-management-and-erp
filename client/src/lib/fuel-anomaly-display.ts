import type { FuelAnomaly } from "@shared/contracts/fuel-anomalies";

const nf = (n: number) => n.toLocaleString("fr-FR");

export interface FuelAnomalyFigures {
  /** Valeur constatée, avec son unité. */
  value: string;
  /** Référence comparée (libellé + valeur), ou null si le contrat ne la fournit pas. */
  reference: string | null;
}

/** Valeur constatée et référence selon la règle, avec la bonne unité (L ou km). */
export function formatFuelAnomalyFigures(a: FuelAnomaly): FuelAnomalyFigures {
  switch (a.rule) {
    case "odometer-regression":
      return {
        value: a.mileage != null ? `${nf(a.mileage)} km` : "—",
        reference: a.previousMileage != null ? `Précédent : ${nf(a.previousMileage)} km` : null,
      };
    case "tank-overflow":
      return {
        value: `${nf(a.quantity)} L`,
        reference: `Réservoir : ${nf(a.tankCapacityL ?? a.averageQuantity)} L, seuil : ${nf(a.threshold)} L`,
      };
    default:
      return {
        value: `${nf(a.quantity)} L`,
        reference: `Moyenne : ${nf(a.averageQuantity)} L, seuil : ${nf(a.threshold)} L`,
      };
  }
}
