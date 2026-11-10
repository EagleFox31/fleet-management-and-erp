import { TREASURY_FUEL_CARD_READ_ROLES } from "@shared/constants/roles";

/**
 * Solde de la carte carburant (`GET /api/fuel-card/balance`) : les montants (solde, crédits, débits,
 * litres, derniers mouvements) vont à `TREASURY_FUEL_CARD_READ_ROLES` seulement, la même liste que le solde
 * de la check-list de lancement (`canReadFuelCardBalance`). Les autres rôles du personnel (chauffeur,
 * technicien...) ne reçoivent que ce que lit le tableau de bord chauffeur : le prix moyen au litre et sa source.
 * Liste blanche : un champ ajouté plus tard au service reste invisible pour eux. Échec fermé sur rôle absent.
 */
const PRICE_ONLY_KEYS = [
  "averagePricePerLiter",
  "averagePricePerLiterUsed",
  "averagePricePerLiterReal",
  "averagePricePerLiterFallback",
  "priceSource",
] as const;

export function canReadFuelCardAmounts(role: string | null | undefined): boolean {
  return (TREASURY_FUEL_CARD_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

export function presentFuelCardBalance<T extends Record<string, unknown>>(
  reader: { role?: string | null } | null | undefined,
  balance: T,
): T | Pick<T, Extract<(typeof PRICE_ONLY_KEYS)[number], keyof T>> {
  if (canReadFuelCardAmounts(reader?.role)) return balance;
  const kept: Record<string, unknown> = {};
  for (const key of PRICE_ONLY_KEYS) if (key in balance) kept[key] = balance[key];
  return kept as Pick<T, Extract<(typeof PRICE_ONLY_KEYS)[number], keyof T>>;
}

const RUNNING_BALANCE_KEYS = ["balance", "fuelBalance"] as const;

/** Solde courant de la carte écrit sur une ligne de plein (`fuel_records.balance`, `fuel_balance`). */
export function omitFuelCardRunningBalance<T>(record: T): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const next: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of RUNNING_BALANCE_KEYS) delete next[key];
  return next as T;
}

/**
 * Pleins renvoyés à un lecteur : le solde courant de la carte n'est lisible que par
 * `TREASURY_FUEL_CARD_READ_ROLES`. Accepte une ligne ou une liste ; les autres rôles perdent `balance` et
 * `fuelBalance`, tout le reste est conservé (quantité, coût, prix au litre).
 */
export function withoutFuelCardBalance<T>(reader: { role?: string | null } | null | undefined, value: T): T {
  if (canReadFuelCardAmounts(reader?.role)) return value;
  return Array.isArray(value) ? (value.map((item) => omitFuelCardRunningBalance(item)) as unknown as T) : omitFuelCardRunningBalance(value);
}
