/**
 * Clé de requête d'une régularisation de plein mission : choisie par le client pour une
 * soumission, rejouée telle quelle en cas de double clic ou de nouvel envoi après une coupure.
 * Même alphabet que l'en-tête Idempotency-Key (ASCII imprimable sans espace), 8 à 100 caractères.
 */
export const REGULARIZATION_REQUEST_KEY_PATTERN = /^[\x21-\x7e]{8,100}$/;

export type MissionRegularizationEntry = Record<string, unknown> & { requestKey?: string };

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Entrée du journal de régularisation (workflowData.fuelTracking.regularizations) portant cette clé. */
export function findMissionRegularization(workflowData: unknown, requestKey: string): MissionRegularizationEntry | null {
  const fuelTracking = asPlainObject(asPlainObject(workflowData)?.fuelTracking);
  const entries = Array.isArray(fuelTracking?.regularizations) ? fuelTracking.regularizations : [];
  for (const entry of entries) {
    const obj = asPlainObject(entry);
    if (obj && obj.requestKey === requestKey) return obj as MissionRegularizationEntry;
  }
  return null;
}

/** Vrai si la nouvelle soumission décrit le même plein que l'entrée déjà enregistrée sous sa clé. */
export function isSameRegularization(
  entry: MissionRegularizationEntry,
  payload: { vehicleId: number; quantity: number; unitPrice: number },
): boolean {
  return (
    Number(entry.quantity) === payload.quantity &&
    Number(entry.unitPrice) === payload.unitPrice &&
    (entry.vehicleId === undefined || Number(entry.vehicleId) === payload.vehicleId)
  );
}
