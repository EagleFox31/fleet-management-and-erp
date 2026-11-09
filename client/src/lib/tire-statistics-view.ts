/**
 * Lecture de `GET /api/tires/statistics-advanced` pour /inventory/tires.
 *
 * - `totalTires` et `totalValue` arrivent en texte (SUM Postgres) ou en nombre : ils sont
 *   convertis une seule fois, ici. Une valeur illisible devient `null`, jamais 0.
 * - Une liste d'actions absente devient `null`, jamais une liste vide.
 * - L'affichage passe par `statText` : `null` s'affiche « Indisponible ».
 */
import type {
  TireRequiredActionsJson as TireRequiredActions,
  TireStatisticsAdvancedJson as TireStatisticsAdvanced,
} from "@shared/contracts/tire-statistics-advanced";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

export type ActionLists = { [K in keyof TireRequiredActions]: TireRequiredActions[K] | null };

export interface TireStatisticsView {
  totalTires: number | null;
  totalValue: number | null;
  averageWear: number | null;
  rotationsThisMonth: number | null;
  requiredActions: ActionLists;
}

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseStatNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return NUMERIC_TEXT.test(text) ? Number(text) : null;
}

function listOrNull<T>(value: T[] | undefined): T[] | null {
  return Array.isArray(value) ? value : null;
}

export function toTireStatisticsView(raw: TireStatisticsAdvanced): TireStatisticsView {
  const actions: Partial<TireRequiredActions> = raw.requiredActions ?? {};
  return {
    totalTires: parseStatNumber(raw.totalTires),
    totalValue: parseStatNumber(raw.totalValue),
    averageWear: parseStatNumber(raw.averageWear),
    rotationsThisMonth: parseStatNumber(raw.rotationsThisMonth),
    requiredActions: {
      lowStock: listOrNull(actions.lowStock),
      outOfStock: listOrNull(actions.outOfStock),
      criticalWear: listOrNull(actions.criticalWear),
      rotationDue: listOrNull(actions.rotationDue),
      rotationApproaching: listOrNull(actions.rotationApproaching),
    },
  };
}

/**
 * Références sous le seuil minimal, ruptures comprises (un pneu à 0 est sous le seuil).
 * Le service range chaque pneu dans une seule des deux listes ; le compte se fait quand même
 * par id. Une liste absente rend `null`, jamais une somme partielle.
 */
export function stockAlertCount(actions: ActionLists): number | null {
  const { lowStock, outOfStock } = actions;
  if (!lowStock || !outOfStock) return null;
  return new Set([...lowStock, ...outOfStock].map((action) => action.tire.id)).size;
}

/** Stock critique + listes demandées ; `null` dès qu'une liste manque. */
export function actionCount(
  actions: ActionLists,
  others: readonly Exclude<keyof TireRequiredActions, "lowStock" | "outOfStock">[],
): number | null {
  let total = stockAlertCount(actions);
  for (const key of others) {
    const list = actions[key];
    if (total === null || !list) return null;
    total += list.length;
  }
  return total;
}

export function listCount(list: readonly unknown[] | null | undefined): number | null {
  return list ? list.length : null;
}

export function statText<T extends string | number = number>(
  value: number | null | undefined,
  format?: (value: number) => T,
): T | number | string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return format ? format(value) : value;
}
