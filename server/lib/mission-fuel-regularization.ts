/**
 * Clé de requête d'un plein de mission (normal ou régularisation) : choisie par le client pour une
 * soumission, rejouée telle quelle en cas de double clic ou de nouvel envoi après une coupure.
 * Même alphabet que l'en-tête Idempotency-Key (ASCII imprimable sans espace), 8 à 100 caractères.
 * La clé vit dans l'onglet qui saisit : deux onglets font deux soumissions, donc deux pleins.
 */
export const MISSION_FUEL_REQUEST_KEY_PATTERN = /^[\x21-\x7e]{8,100}$/;

/** Clé absente : client antérieur à la clé obligatoire, la page doit être rechargée. */
export const MISSING_FUEL_REQUEST_KEY_MESSAGE =
  "Clé de saisie manquante : rechargez la page, puis enregistrez le plein à nouveau.";

/** Même clé, autre plein : le second envoi n'est pas un rejeu, il est refusé. */
export const DIFFERENT_FUEL_SUBMISSION_MESSAGE =
  "Ce plein a déjà été enregistré avec d'autres valeurs. Rechargez la page pour voir les pleins enregistrés.";

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

/** Plein tel qu'enregistré (colonnes de fuel_records utiles à la comparaison). */
export type StoredFuelRecord = {
  missionId: number | null;
  vehicleId: number | null;
  quantity: number | string | null;
  unitPrice: number | string | null;
  date: string | null;
  stationName: string | null;
  notes: string | null;
};

/** Nouvelle soumission, déjà mise sous la forme écrite en base. `date` à null : non fournie, non comparée. */
export type FuelSubmission = {
  missionId: number;
  vehicleId: number;
  quantity: number;
  unitPrice: number;
  /** AAAA-MM-JJ, seulement si le client a fourni la date (sinon le serveur prend « maintenant »). */
  date: string | null;
  stationName: string;
  notes: string;
};

// quantity est un real (float4) et unit_price un numeric(15,2) arrondi au centime : comparer à la précision stockée.
const sameQuantity = (stored: unknown, sent: number) =>
  Math.abs(Number(stored) - sent) <= Math.max(1, Math.abs(sent)) * 1e-6;
const samePrice = (stored: unknown, sent: number) => Math.abs(Number(stored) - sent) <= 0.005 + 1e-9;

/**
 * Vrai si la soumission décrit le même plein que celui déjà enregistré sous sa clé : mission, véhicule,
 * quantité, prix, date (si fournie), station et notes (motif compris pour une régularisation).
 * Faux : le second envoi est refusé (409), jamais rejoué ni débité.
 */
export function isSameFuelSubmission(record: StoredFuelRecord, submission: FuelSubmission): boolean {
  return (
    record.missionId === submission.missionId &&
    record.vehicleId === submission.vehicleId &&
    sameQuantity(record.quantity, submission.quantity) &&
    samePrice(record.unitPrice, submission.unitPrice) &&
    (submission.date === null || String(record.date ?? "").slice(0, 10) === submission.date) &&
    (record.stationName ?? "") === submission.stationName &&
    (record.notes ?? "") === submission.notes
  );
}

/** Notes d'un débit telles qu'écrites dans fuel_records.notes (une seule source pour l'écriture et le rejeu). */
export function buildFuelConsumptionNotes(data: {
  isPreDeparture?: boolean;
  notes?: string;
  destination: string;
  clientName?: string;
}): string {
  return [
    data.isPreDeparture ? "[PRE_DEPART]" : null,
    data.notes?.trim() || null,
    `Destination: ${data.destination}${data.clientName ? ` - Client: ${data.clientName}` : ""}`,
  ]
    .filter((segment): segment is string => Boolean(segment && segment.trim()))
    .join(" | ");
}
