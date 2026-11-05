/**
 * Éligibilité CPC d'un chauffeur à une mission.
 *
 * Source unique : le serveur refuse l'affectation avec cette règle, l'assistant
 * de création de mission l'applique à l'identique pour expliquer le blocage.
 *
 * La règle porte sur le statut CPC ENREGISTRÉ du chauffeur (`drivers.cpc_status`),
 * insensible à la casse et aux accents, ET sur l'expiration de la formation quand la
 * date existe (date + 731 jours, jour J valable). Date absente : le statut fait foi.
 * La marge d'alerte de 59 jours n'en fait pas partie. La liste `/api/drivers` recalcule son statut d'affichage depuis
 * `cpcTrainingDate`, ce qui donne « NON FORMÉ » à un chauffeur dont le statut
 * enregistré est valide mais dont la date est absente.
 */

import { addDaysToDateOnly, isExpiredOn, todayUtcDateOnly } from "./expiry-day";

/** Durée de validité d'une formation CPC, en jours (partagée avec `calculateCPCStatus`). */
export const CPC_VALIDITY_DAYS = 731;

export interface DriverCpcInput {
  /** Statut enregistré (colonne `cpc_status`). */
  cpcStatus?: string | null;
  /** Date de formation (colonne `cpc_training_date`). Absente : le statut enregistré fait foi. */
  cpcTrainingDate?: string | Date | null;
}

/** Dernier jour de validité de la formation (`YYYY-MM-DD`), `null` si la date manque. */
export function cpcExpiryDayOf(cpcTrainingDate: string | Date | null | undefined): string | null {
  return addDaysToDateOnly(cpcTrainingDate, CPC_VALIDITY_DAYS);
}

function formatFr(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-");
  return `${d}/${m}/${y}`;
}

export interface DriverCpcEligibility {
  eligible: boolean;
  /** Raison lisible, absente quand le chauffeur est éligible. */
  reason?: string;
}

export function normalizeCpcStatus(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

export function isCpcStatusValid(value: string | null | undefined): boolean {
  return normalizeCpcStatus(value) === "FORME";
}

export function getDriverCpcEligibility(
  driver: DriverCpcInput,
  today: string = todayUtcDateOnly(),
): DriverCpcEligibility {
  if (isCpcStatusValid(driver.cpcStatus)) {
    // Le statut enregistré n'est recalculé par aucune tâche planifiée : une garde
    // réglementaire juge la date quand elle existe.
    const expiry = cpcExpiryDayOf(driver.cpcTrainingDate);
    if (expiry && isExpiredOn(expiry, today)) {
      return { eligible: false, reason: `Formation CPC expirée le ${formatFr(expiry)}.` };
    }
    return { eligible: true };
  }
  const status = (driver.cpcStatus || "").trim();
  return {
    eligible: false,
    reason: status
      ? `CPC non valide (statut : ${status}). Un chauffeur au statut FORMÉ est requis.`
      : "CPC non renseigné. Un chauffeur au statut FORMÉ est requis.",
  };
}
