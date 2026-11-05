import { toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";

/** Message de saisie partagé par les routes qui posent une date de formation CPC. */
export const CPC_TRAINING_DATE_FUTURE_MESSAGE = "La date de formation CPC ne peut pas être dans le futur.";

/**
 * Vrai si la date de formation tombe après aujourd'hui (jour UTC). Controle de saisie seulement :
 * les imports et les données déjà en base ne l'appliquent pas. Date absente ou illisible : faux.
 */
export function isCpcTrainingDateInFuture(value: string | Date | null | undefined): boolean {
  const day = toExpiryDateOnly(value);
  return day !== null && day > todayUtcDateOnly();
}
