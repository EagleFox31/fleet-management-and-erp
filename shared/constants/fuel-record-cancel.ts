import { z } from "zod";
import { canDeleteFuelRecord } from "./fuel-record-delete";

/**
 * Plein validé : immuable. Une correction passe par l'annulation tracée (motif obligatoire),
 * puis par la saisie d'un nouveau plein. Source unique des messages et de la règle de rôle,
 * pour le serveur (FuelService) et pour les écrans.
 */
export const FUEL_RECORD_VALIDATED_EDIT_MESSAGE =
  "Ce plein est validé : il ne se modifie plus. Annulez-le avec un motif, puis saisissez-en un nouveau.";
export const FUEL_RECORD_VALIDATED_DELETE_MESSAGE =
  "Un plein validé ne se supprime pas : annulez-le avec un motif.";
export const FUEL_RECORD_BUDGET_SETTLED_MESSAGE =
  "Le budget de la mission est soldé : l'annulation n'est plus possible, contactez la comptabilité.";
export const FUEL_RECORD_CANCEL_NOT_VALIDATED_MESSAGE =
  "Ce plein n'est pas validé : supprimez-le au lieu de l'annuler.";
export const FUEL_RECORD_ALREADY_REMOVED_MESSAGE =
  "Ce plein est déjà annulé ou supprimé.";
export const FUEL_RECORD_CANCEL_FORBIDDEN_MESSAGE =
  "Vous n'avez pas le droit d'annuler ce plein.";
export const FUEL_RECORD_CANCEL_REASON_MIN_LENGTH = 3;
export const FUEL_RECORD_CANCEL_REASON_MAX_LENGTH = 500;

export function isFuelRecordValidated(record: { validationStatus?: string | null }): boolean {
  return record.validationStatus === "validated";
}

/** Mêmes rôles que la suppression (le plein annulé est une suppression douce tracée). */
export const canCancelFuelRecord = canDeleteFuelRecord;

/** Corps de POST /api/fuel-records/:id/cancel. */
export const fuelRecordCancelSchema = z.object({
  reason: z.string().trim().min(FUEL_RECORD_CANCEL_REASON_MIN_LENGTH, "Le motif d'annulation est obligatoire (3 caractères au minimum).")
    .max(FUEL_RECORD_CANCEL_REASON_MAX_LENGTH, "Le motif d'annulation est limité à 500 caractères."),
});
