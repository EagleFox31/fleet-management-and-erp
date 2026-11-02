/**
 * Stock pneu : neuf (`tires.stock_quantity`) et usagé (`tires.used_stock_quantity`).
 * Un pneu démonté vers le stock a roulé : il revient en usagé. Le montage prend du neuf par
 * défaut ; l'usagé se choisit explicitement. Seul le neuf est valorisé et suivi en stock bas.
 */
export const TIRE_STOCK_SOURCES = ["new", "used"] as const;
export type TireStockSource = (typeof TIRE_STOCK_SOURCES)[number];

export const TIRE_STOCK_SOURCE_LABELS: Record<TireStockSource, string> = {
  new: "Neuf",
  used: "Usagé",
};

export function tireStockSourceLabel(source: string): string {
  return TIRE_STOCK_SOURCE_LABELS[source as TireStockSource] ?? source;
}

/** « 1 usagé », « 3 usagés ». */
export function usedTiresLabel(count: number): string {
  return `${count} usagé${count > 1 ? "s" : ""}`;
}
