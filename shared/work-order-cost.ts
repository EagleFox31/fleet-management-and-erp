/**
 * Coût d'un ordre de travail : main-d'oeuvre + pièces + rotations de pneus.
 *
 * Source unique de la règle pour l'écran de détail, le PDF de l'OT (WO5), le
 * service technicien et le KPI de coût (`server/lib/kpi-rules.ts`).
 *
 * Main-d'oeuvre : heures réelles × taux horaire en vigueur à la date de l'OT
 * quand un taux existe et que des heures sont saisies ; sinon le coût saisi
 * (`work_orders.cost`). Jamais les deux : `cost` est déjà la main-d'oeuvre.
 *
 * Les montants arrivent de la base en chaîne décimale (`numeric`) : toute
 * valeur absente ou illisible compte 0, jamais NaN.
 */

type Money = string | number | null | undefined;

export interface WorkOrderCostInput {
  /** `work_orders.cost` : main-d'oeuvre saisie. */
  baseCost: Money;
  parts: ReadonlyArray<{ unitPrice?: Money; quantity?: Money }> | null | undefined;
  tireRotations: ReadonlyArray<{ cost?: Money }> | null | undefined;
  /** Somme des heures réelles des lignes de travail non annulées. */
  laborHours?: Money;
  /** Taux horaire HT en vigueur à la date de l'OT, ou `null` s'il n'y en a pas. */
  laborRate?: Money;
}

export interface WorkOrderCost {
  /** Main-d'oeuvre retenue (heures × taux, ou coût saisi). */
  baseCost: number;
  partsCost: number;
  tiresCost: number;
  totalCost: number;
  /** Vrai quand la main-d'oeuvre vient des heures × taux. */
  laborValued: boolean;
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

export type LaborRate = { effectiveFrom: string; hourlyRateHt: number };

/** Taux en vigueur à `date` (AAAA-MM-JJ) : la ligne au plus grand `effectiveFrom` inférieur ou égal. */
export function laborRateAt(rates: readonly LaborRate[], date: string): LaborRate | null {
  let best: LaborRate | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom <= date && (best === null || rate.effectiveFrom > best.effectiveFrom)) best = rate;
  }
  return best;
}

/** Règle de main-d'oeuvre, sans arrondi : partagée avec le KPI, qui arrondit au FCFA. */
export function laborCost(input: { baseCost: Money; laborHours?: Money; laborRate?: Money }): {
  amount: number;
  valued: boolean;
} {
  const hours = toMoney(input.laborHours);
  const hasRate = input.laborRate !== null && input.laborRate !== undefined && input.laborRate !== "";
  const valued = hasRate && hours > 0;
  return { amount: valued ? hours * toMoney(input.laborRate) : toMoney(input.baseCost), valued };
}

export function computeWorkOrderCost(input: WorkOrderCostInput): WorkOrderCost {
  const parts = Array.isArray(input.parts) ? input.parts : [];
  const rotations = Array.isArray(input.tireRotations) ? input.tireRotations : [];

  const labor = laborCost(input);
  const baseCost = roundCents(labor.amount);
  const partsCost = roundCents(parts.reduce((sum, p) => sum + toMoney(p.unitPrice) * toMoney(p.quantity), 0));
  const tiresCost = roundCents(rotations.reduce((sum, r) => sum + toMoney(r.cost), 0));

  return {
    baseCost,
    partsCost,
    tiresCost,
    totalCost: roundCents(baseCost + partsCost + tiresCost),
    laborValued: labor.valued,
  };
}

/** Heures réelles d'un OT : lignes de travail non annulées. */
export function totalLaborHours(
  items: ReadonlyArray<{ actualHours?: Money; status?: string | null }> | null | undefined,
): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, i) => (i.status === "cancelled" ? sum : sum + toMoney(i.actualHours)), 0);
}
