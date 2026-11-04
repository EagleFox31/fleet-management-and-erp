import { FUEL_CARD_MANAGER_ROLES } from "./roles";

/**
 * Qui peut supprimer un plein : source unique pour le serveur (FuelService.deleteFuelRecord)
 * et pour l'écran (bouton supprimer).
 *
 *  - plein qui a mouvementé la carte (débit ou crédit non nul) : FUEL_CARD_MANAGER_ROLES,
 *    suppression douce tracée ;
 *  - plein physique (aucun mouvement) : rôles atelier, suppression définitive (garde historique).
 */
export const FUEL_PHYSICAL_RECORD_DELETE_ROLES = ["admin", "workshop_manager"] as const;

type Amount = number | string | null | undefined;

function amountOf(value: Amount): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Un plein a mouvementé la carte carburant s'il porte un débit ou un crédit non nul. */
export function hasMovedFuelCard(record: { debitAmount?: Amount; creditAmount?: Amount }): boolean {
  return amountOf(record.debitAmount) !== 0 || amountOf(record.creditAmount) !== 0;
}

export function canDeleteFuelRecord(
  role: string | null | undefined,
  record: { debitAmount?: Amount; creditAmount?: Amount },
): boolean {
  if (!role) return false;
  const allowed: readonly string[] = hasMovedFuelCard(record) ? FUEL_CARD_MANAGER_ROLES : FUEL_PHYSICAL_RECORD_DELETE_ROLES;
  return allowed.includes(role);
}
