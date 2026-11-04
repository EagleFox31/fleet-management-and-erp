import { AppError } from "./app-error";
import { hasMovedFuelCard } from "@shared/constants/fuel-record-delete";

/**
 * Verrou comptable d'un plein qui a mouvementé la carte carburant.
 *
 * Un plein dont `debitAmount` ou `creditAmount` est non nul a déjà modifié le solde de la
 * carte. Réécrire sa quantité, son coût, son véhicule ou sa date ferait diverger la ligne
 * du solde, que rien ne recalcule. Notes, kilométrage et « plein complet » restent libres.
 *
 * Les valeurs sont comparées normalisées : 50 et "50.00" sont égaux, une date se compare au
 * jour. Une simple ré-sauvegarde du formulaire passe donc sans erreur.
 */

export const LEDGER_LOCKED_FIELDS = ["vehicleId", "date", "quantity", "cost"] as const;
export type LedgerLockedField = (typeof LEDGER_LOCKED_FIELDS)[number];

export const FUEL_RECORD_LEDGER_LOCKED_MESSAGE =
  "Ce plein a déjà mouvementé la carte carburant : quantité, coût, véhicule et date ne se modifient plus. " +
  "Pour corriger, passez par une régularisation, ou demandez l'annulation du plein puis saisissez-en un nouveau.";

type LedgerRecord = {
  vehicleId: number | null;
  date: string | Date | null;
  quantity: number | string | null;
  cost: number | string | null;
  debitAmount?: number | string | null;
  creditAmount?: number | string | null;
};

type LedgerPatch = Partial<Record<LedgerLockedField, unknown>>;

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function day(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

// Définition partagée avec l'écran (shared/constants/fuel-record-delete.ts).
export { hasMovedFuelCard };

function sameValue(field: LedgerLockedField, before: unknown, after: unknown): boolean {
  if (field === "date") return day(before) === day(after);
  const a = amount(before);
  const b = amount(after);
  if (a === null || b === null) return a === b;
  // Montants en centimes (numeric(15,2)), quantités en `real` : tolérance d'arrondi.
  return Math.abs(a - b) < 0.005;
}

/** Champs verrouillés que le correctif changerait réellement ; vide si rien ne bouge. */
export function changedLedgerFields(record: LedgerRecord, patch: LedgerPatch): LedgerLockedField[] {
  return LEDGER_LOCKED_FIELDS.filter((field) => patch[field] !== undefined && !sameValue(field, record[field], patch[field]));
}

/**
 * Lève 409 si le plein a mouvementé la carte et que le correctif touche un champ verrouillé.
 * Sinon, renvoie le correctif sans les champs verrouillés d'un plein qui a mouvementé la
 * carte : la valeur stockée reste écrite, même quand l'envoi n'en diffère que d'un arrondi
 * (sans quoi des ré-sauvegardes répétées feraient dériver litres et prix au litre).
 */
export function assertFuelRecordLedgerEditable<P extends LedgerPatch>(record: LedgerRecord, patch: P): P {
  if (!hasMovedFuelCard(record)) return patch;
  if (changedLedgerFields(record, patch).length > 0) throw new AppError(409, FUEL_RECORD_LEDGER_LOCKED_MESSAGE);
  const kept = { ...patch };
  for (const field of LEDGER_LOCKED_FIELDS) delete kept[field];
  return kept;
}
