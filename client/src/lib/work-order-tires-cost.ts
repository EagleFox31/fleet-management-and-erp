import { computeWorkOrderCost, type WorkOrderCost, type WorkOrderCostInput } from "@shared/work-order-cost";
import { listQueryView } from "@/lib/query-view";

/** Déplacé dans `@/lib/query-view` ; ré-exporté pour les importeurs existants. */
export { listQueryView };

export type WorkOrderDisplayCost = Omit<WorkOrderCost, "partsCost" | "tiresCost" | "totalCost"> & {
  /** `null` tant que les pièces de l'OT n'ont jamais été lues : inconnu, pas zéro. */
  partsCost: number | null;
  /** `null` tant que les rotations n'ont jamais été lues : inconnu, pas zéro. */
  tiresCost: number | null;
  /** `null` dès que le coût pièces ou pneus est inconnu : un total sans eux serait sous-évalué. */
  totalCost: number | null;
};

/**
 * Coût d'OT pour l'écran et le PDF. Pièces ou rotations non lues (chargement, ou échec sans
 * données en cache) : leur coût et le total sont inconnus. Une relance en échec avec des
 * données en cache garde ces données, TanStack les conserve dans `data`.
 */
export function workOrderDisplayCost(
  input: Omit<WorkOrderCostInput, "parts" | "tireRotations"> & {
    parts: WorkOrderCostInput["parts"] | undefined;
    tireRotations: WorkOrderCostInput["tireRotations"] | undefined;
  },
): WorkOrderDisplayCost {
  const partsKnown = Array.isArray(input.parts);
  const tiresKnown = Array.isArray(input.tireRotations);
  const cost = computeWorkOrderCost({
    ...input,
    parts: partsKnown ? input.parts : [],
    tireRotations: tiresKnown ? input.tireRotations : [],
  });
  return {
    ...cost,
    partsCost: partsKnown ? cost.partsCost : null,
    tiresCost: tiresKnown ? cost.tiresCost : null,
    totalCost: partsKnown && tiresKnown ? cost.totalCost : null,
  };
}

/** Libellé d'un montant qui peut être inconnu : jamais « 0 » à la place d'une donnée absente. */
export function formatKnownCost(
  value: number | null,
  format: (amount: number) => string,
  { isError }: { isError: boolean },
): string {
  if (value !== null) return format(value);
  return isError ? "Indisponible" : "Chargement…";
}
