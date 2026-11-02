/**
 * Coût d'un ordre de travail : coût de base + pièces + rotations de pneus.
 *
 * Source unique pour l'écran de détail et le PDF de l'OT (WO5). Le serveur
 * applique la même définition en SQL (`technician-work-orders-service`,
 * `kpi-service`) ; `tests/integration/work-order-cost.test.ts` vérifie l'accord.
 *
 * Les montants arrivent de la base en chaîne décimale (`numeric`) : toute
 * valeur absente ou illisible compte 0, jamais NaN.
 */

type Money = string | number | null | undefined;

export interface WorkOrderCostInput {
  baseCost: Money;
  parts: ReadonlyArray<{ unitPrice?: Money; quantity?: Money }> | null | undefined;
  tireRotations: ReadonlyArray<{ cost?: Money }> | null | undefined;
}

export interface WorkOrderCost {
  baseCost: number;
  partsCost: number;
  tiresCost: number;
  totalCost: number;
}

export function toMoney(value: Money): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Total d'une ligne de pièce (prix unitaire × quantité). */
export function partLineCost(unitPrice: Money, quantity: Money): number {
  return roundCents(toMoney(unitPrice) * toMoney(quantity));
}

export function computeWorkOrderCost(input: WorkOrderCostInput): WorkOrderCost {
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const rotations = Array.isArray(input.tireRotations) ? input.tireRotations : [];

  const baseCost = roundCents(toMoney(input.baseCost));
  const partsCost = roundCents(parts.reduce((sum, p) => sum + toMoney(p.unitPrice) * toMoney(p.quantity), 0));
  const tiresCost = roundCents(rotations.reduce((sum, r) => sum + toMoney(r.cost), 0));

  return { baseCost, partsCost, tiresCost, totalCost: roundCents(baseCost + partsCost + tiresCost) };
}
