/**
 * Jour calendaire des échéances : une règle, une source (P3-2, D1/D2/D4).
 *
 * Toutes les dates d'échéance sont des dates SANS heure (`YYYY-MM-DD`). Le « jour
 * courant » est la date UTC de l'instant : le jour change à minuit UTC, soit 01:00 à
 * Douala. Entre 00:00 et 01:00 heure de Douala, le jour J est donc encore la veille
 * (décalage accepté, décision produit). Aucun accesseur local (`getDate`...) sur ces
 * chemins : éligibilité, statistiques documentaires et alertes passent par ici.
 *
 * Un document dont l'échéance est le jour J est encore VALABLE ; il est expiré à J+1
 * (décision produit #224, 3 novembre 2026). Même règle pour les papiers véhicule et le
 * permis.
 */

import { todayUtcDateOnly, utcDateOnly } from "../lib/utc-day";

export { todayUtcDateOnly };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Partie date `YYYY-MM-DD` d'une échéance (chaîne ISO ou `Date`), `null` si absente ou illisible. */
export function toExpiryDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : utcDateOnly(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const dateOnly = `${match[1]}-${match[2]}-${match[3]}`;
  // Date impossible (2026-02-30, 2026-13-45) : illisible, jamais NaN en aval.
  const parsed = Date.parse(`${dateOnly}T00:00:00Z`);
  return !Number.isNaN(parsed) && utcDateOnly(new Date(parsed)) === dateOnly ? dateOnly : null;
}

/** Jours calendaires entre `today` et `expiry` (dates `YYYY-MM-DD`). Négatif = échu, 0 = jour J. */
export function daysBetweenDateOnly(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);
}

/** Vrai si l'échéance est passée (au plus tard hier). Le jour J est valable. */
export function isExpiredOn(expiry: string | Date | null | undefined, today: string): boolean {
  const dateOnly = toExpiryDateOnly(expiry);
  return dateOnly !== null && daysBetweenDateOnly(dateOnly, today) < 0;
}

/**
 * Permis chauffeur : même jour d'échéance que les papiers véhicule (valable le jour J,
 * expiré à J+1, jour UTC). Contrairement à un papier, un permis absent ou illisible
 * compte comme expiré : la check-list et le lancement le refusent.
 */
export function isDriverLicenseExpiredOn(expiry: string | Date | null | undefined, today: string): boolean {
  return toExpiryDateOnly(expiry) === null || isExpiredOn(expiry, today);
}
