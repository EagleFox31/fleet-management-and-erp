/**
 * Jour calendaire des échéances : une règle, une source (P3-2, D1/D2/D4).
 *
 * Toutes les dates d'échéance sont des dates SANS heure (`YYYY-MM-DD`). Le « jour
 * courant » est la date UTC de l'instant : le jour change à minuit UTC, soit 01:00 à
 * Douala. Entre 00:00 et 01:00 heure de Douala, le jour J est donc encore la veille
 * (décalage accepté, décision produit). Aucun accesseur local (`getDate`...) sur ces
 * chemins : éligibilité, statistiques documentaires et alertes passent par ici.
 *
 * Un document dont l'échéance est le jour J est EXPIRÉ (lancement de mission bloqué).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Date UTC (`YYYY-MM-DD`) d'un instant. */
export function todayUtcDateOnly(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Partie date `YYYY-MM-DD` d'une échéance (chaîne ISO ou `Date`), `null` si absente ou illisible. */
export function toExpiryDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Jours calendaires entre `today` et `expiry` (dates `YYYY-MM-DD`). Négatif = échu, 0 = jour J. */
export function daysBetweenDateOnly(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);
}

/** Vrai si l'échéance est aujourd'hui ou passée. */
export function isExpiredOn(expiry: string | Date | null | undefined, today: string): boolean {
  const dateOnly = toExpiryDateOnly(expiry);
  return dateOnly !== null && daysBetweenDateOnly(dateOnly, today) <= 0;
}
