/**
 * Jour d'échéance d'un plan d'entretien périodique (#342), sur la règle de `expiry-day.ts` :
 * dates sans heure (`YYYY-MM-DD`), jour courant = date UTC de l'instant, aucun accesseur local.
 *
 * L'ancien calcul (trois copies dans les écrans d'entretien) ajoutait la période par
 * `setDate` / `setMonth` à l'heure locale, puis arrondissait au jour supérieur l'écart en
 * millisecondes avec l'instant courant. Le nombre de jours dépendait du fuseau du navigateur :
 * le 30 mars à 23h30 UTC, une échéance au 1er avril donnait 2, 1 ou -2 jours selon la zone.
 */

import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "./expiry-day";

export type MaintenanceFrequency = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "mileage";

/**
 * Prochaine échéance (`YYYY-MM-DD`) : `scheduledDate` + une période. `null` pour un plan au
 * kilométrage, une date absente ou illisible. Un mois trop court déborde comme `setMonth`
 * (31 janvier + 1 mois = 3 mars, 2 mars les années bissextiles) : comportement historique conservé.
 */
export function nextMaintenanceDueDateOnly(
  scheduledDate: string | Date | null | undefined,
  frequency: string,
  frequencyValue: number,
): string | null {
  const base = toExpiryDateOnly(scheduledDate);
  if (base === null || frequency === "mileage") return null;
  const [y, m, d] = base.split("-").map(Number);
  const months = frequency === "monthly" ? frequencyValue : frequency === "quarterly" ? frequencyValue * 3 : frequency === "yearly" ? frequencyValue * 12 : 0;
  const days = frequency === "daily" ? frequencyValue : frequency === "weekly" ? frequencyValue * 7 : 0;
  // Fréquence inconnue : échéance = date de départ, comme l'ancien `switch` sans `default`.
  return new Date(Date.UTC(y, m - 1 + months, d + days)).toISOString().slice(0, 10);
}

/** Jours calendaires jusqu'à la prochaine échéance : négatif = en retard, 0 = jour J. `null` sans échéance datée. */
export function maintenanceDaysUntil(
  schedule: { scheduledDate?: string | Date | null; frequency: string; frequencyValue: number },
  now: Date = new Date(),
): number | null {
  const due = nextMaintenanceDueDateOnly(schedule.scheduledDate, schedule.frequency, schedule.frequencyValue);
  return due === null ? null : daysBetweenDateOnly(due, todayUtcDateOnly(now));
}
