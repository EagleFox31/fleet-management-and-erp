import { canWriteFuelPrice } from "@shared/constants/roles";

/**
 * Le prix du litre n'est imposé (champ en lecture seule, prix du jour) que si le
 * suivi des prix datés est actif (drapeau `fuel-prices`) ET que le rôle ne peut pas
 * le fixer. Drapeau coupé : aucune liste de prix n'existe (404), la saisie reste libre.
 */
export function isFuelPriceImposed(role: string | null | undefined, fuelPricesEnabled: boolean): boolean {
  return fuelPricesEnabled && !canWriteFuelPrice(role);
}

/** Date locale AAAA-MM-JJ (et non la date UTC de `toISOString`). */
export function localDateKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
