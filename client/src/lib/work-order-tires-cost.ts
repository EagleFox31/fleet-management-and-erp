import { computeWorkOrderCost, type WorkOrderCost, type WorkOrderCostInput } from "@shared/work-order-cost";

export type WorkOrderDisplayCost = Omit<WorkOrderCost, "tiresCost" | "totalCost"> & {
  /** `null` tant que les rotations n'ont jamais été lues : inconnu, pas zéro. */
  tiresCost: number | null;
  /** `null` dès que le coût pneus est inconnu : un total sans les pneus serait sous-évalué. */
  totalCost: number | null;
};

/**
 * Coût d'OT pour l'écran et le PDF. Rotations non lues (chargement, ou échec sans données
 * en cache) : coût pneus et total inconnus. Une relance en échec avec des données en cache
 * garde ces données, TanStack les conserve dans `data`.
 */
export function workOrderDisplayCost(
  input: Omit<WorkOrderCostInput, "tireRotations"> & { tireRotations: WorkOrderCostInput["tireRotations"] | undefined },
): WorkOrderDisplayCost {
  const tiresKnown = Array.isArray(input.tireRotations);
  const cost = computeWorkOrderCost({ ...input, tireRotations: tiresKnown ? input.tireRotations : [] });
  return tiresKnown ? cost : { ...cost, tiresCost: null, totalCost: null };
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
