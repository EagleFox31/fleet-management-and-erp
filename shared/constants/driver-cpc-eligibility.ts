/**
 * Éligibilité CPC d'un chauffeur à une mission.
 *
 * Source unique : le serveur refuse l'affectation avec cette règle, l'assistant
 * de création de mission l'applique à l'identique pour expliquer le blocage.
 *
 * La règle porte sur le statut CPC ENREGISTRÉ du chauffeur (`drivers.cpc_status`),
 * insensible à la casse et aux accents, ET sur l'expiration de la formation quand la
 * date existe (date + 731 jours, jour J valable). Date absente : le statut fait foi.
 * La garde elle-même ne calcule aucune marge d'alerte. Mais le statut enregistré, lui, en porte une :
 * `calculateCPCStatus` y inscrit « À FORMER » dès 59 jours avant l'expiration, et la garde bloque alors
 * un chauffeur dont la formation est encore valable. Le statut n'est recalculé que lors d'une mise à jour
 * du CPC (aucune tâche planifiée). La liste `/api/drivers` recalcule son statut d'affichage depuis
 * `cpcTrainingDate`, ce qui peut afficher « NON FORMÉ » ou « FORMÉ » à l'inverse du statut enregistré.
 */

import { addDaysToDateOnly, daysBetweenDateOnly, isExpiredOn, toExpiryDateOnly, todayUtcDateOnly } from "./expiry-day";

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

/** Motif de refus, stable : les contrats et les écrans (logique) lisent le code ; l'écran affiche le libellé fixe. */
export type CpcIneligibleCode = "EXPIRED" | "NOT_VALID" | "MISSING" | "FUTURE_DATE";

/**
 * Libellé fixe par motif, SANS date ni statut saisi : il est diffusé avec la liste des
 * missions, que lit tout le personnel. Le libellé daté (`reason`) reste réservé aux
 * écrans qui possèdent déjà la date (assistant de mission) et aux messages d'erreur.
 */
export const CPC_INELIGIBLE_LABELS: Record<CpcIneligibleCode, string> = {
  EXPIRED: "Formation CPC expirée.",
  NOT_VALID: "CPC non valide. Un chauffeur au statut FORMÉ est requis.",
  MISSING: "CPC non renseigné. Un chauffeur au statut FORMÉ est requis.",
  FUTURE_DATE: "Date de formation CPC postérieure à aujourd'hui : à vérifier.",
};

export interface DriverCpcEligibility {
  eligible: boolean;
  /** Motif de refus, absent quand le chauffeur est éligible. */
  code?: CpcIneligibleCode;
  /** Libellé fixe du motif (sans date), absent quand le chauffeur est éligible. */
  label?: string;
  /** Raison lisible, absente quand le chauffeur est éligible. Peut contenir la date d'expiration. */
  reason?: string;
}

function refuse(code: CpcIneligibleCode, reason?: string): DriverCpcEligibility {
  const label = CPC_INELIGIBLE_LABELS[code];
  return { eligible: false, code, label, reason: reason ?? label };
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

export type CpcStatusTone = "success" | "warning" | "danger" | "neutral";

/**
 * Ton d'affichage d'un statut CPC enregistré. Insensible à la casse et aux accents
 * (« FORME », « Formé », « a former »). Statut inconnu ou absent : neutre. Les classes CSS
 * restent dans chaque écran, mappées depuis ce ton.
 */
export function cpcStatusTone(value: string | null | undefined): CpcStatusTone {
  switch (normalizeCpcStatus(value).trim()) {
    case "FORME":
      return "success";
    case "A FORMER":
      return "warning";
    case "NON FORME":
      return "danger";
    default:
      return "neutral";
  }
}

export function getDriverCpcEligibility(
  driver: DriverCpcInput,
  today: string = todayUtcDateOnly(),
): DriverCpcEligibility {
  if (isCpcStatusValid(driver.cpcStatus)) {
    // Le statut enregistré n'est recalculé par aucune tâche planifiée : une garde
    // réglementaire juge la date quand elle existe.
    // Une formation datée du futur (import SQL) ne prouve rien : inéligible.
    const trained = toExpiryDateOnly(driver.cpcTrainingDate);
    if (trained && daysBetweenDateOnly(trained, today) > 0) return refuse("FUTURE_DATE");
    const expiry = cpcExpiryDayOf(driver.cpcTrainingDate);
    if (expiry && isExpiredOn(expiry, today)) {
      return refuse("EXPIRED", `Formation CPC expirée le ${formatFr(expiry)}.`);
    }
    return { eligible: true };
  }
  const status = (driver.cpcStatus || "").trim();
  return status
    ? refuse("NOT_VALID", `CPC non valide (statut : ${status}). Un chauffeur au statut FORMÉ est requis.`)
    : refuse("MISSING");
}
