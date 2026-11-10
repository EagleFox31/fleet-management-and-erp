/**
 * Liste blanche de champs du cache hors ligne du chauffeur (cache minimal, décision 7 de V5b).
 * Logique pure. Une forme dit ce qui est gardé : `true` pour une valeur simple, un objet pour
 * un sous-objet, `[forme]` pour un tableau. Toute clé absente de la forme est retirée, à
 * n'importe quelle profondeur ; une valeur de type inattendu est retirée aussi.
 */

export type FieldShape = true | { [key: string]: FieldShape } | [FieldShape];

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

export function pickFields(value: unknown, shape: FieldShape): unknown {
  if (shape === true) return isScalar(value) ? value : undefined;
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.map((item) => pickFields(item, shape[0])).filter((item) => item !== undefined) : undefined;
  }
  if (!isPlain(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(shape)) {
    if (!(key in value)) continue;
    const picked = pickFields(value[key], sub);
    if (picked !== undefined) out[key] = picked;
  }
  return out;
}

const VEHICLE: FieldShape = { id: true, registrationNumber: true };

const ASSIGNMENT: FieldShape = {
  id: true,
  driverId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  vehicleId: true,
  trailerId: true,
  vehicle: VEHICLE,
  trailer: VEHICLE,
};

/** Missions de `/api/drivers/me` : ce que le tableau de bord chauffeur affiche. */
export const DRIVER_ME_MISSION_SHAPE: FieldShape = {
  id: true,
  orderNumber: true,
  status: true,
  pickupAddress: true,
  deliveryAddress: true,
  pickupDate: true,
  deliveryDate: true,
  actualDeliveryDate: true,
  actualDepartureDate: true,
  assignmentStatus: true,
  estimatedDistance: true,
  actualDistance: true,
  clientName: true,
  vehicleRegistration: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleId: true,
  specialInstructions: true,
  pickupLat: true,
  pickupLng: true,
  deliveryLat: true,
  deliveryLng: true,
};

export const DRIVER_ME_SHAPE: FieldShape = {
  driver: { id: true, firstName: true, lastName: true },
  missions: [DRIVER_ME_MISSION_SHAPE],
};

/** Détail d'une mission : références, dates, lieux (libellés et points A/B), véhicule, cargaison, consignes, contact. */
export const MISSION_DETAIL_SHAPE: FieldShape = {
  id: true,
  orderNumber: true,
  status: true,
  currentStep: true,
  pickupAddress: true,
  pickupDate: true,
  pickupLat: true,
  pickupLng: true,
  deliveryAddress: true,
  deliveryDate: true,
  deliveryLat: true,
  deliveryLng: true,
  completedAt: true,
  cargo: true,
  weight: true,
  volume: true,
  specialInstructions: true,
  client: { name: true },
  assignment: ASSIGNMENT,
  assignments: [ASSIGNMENT],
};

/** Pleins de la mission : date, litres, kilométrage, station. Aucun montant (non affiché au chauffeur). */
export const MISSION_FUEL_SHAPE: FieldShape = {
  missionId: true,
  missionStatus: true,
  totalQuantity: true,
  records: [{ id: true, date: true, quantity: true, mileage: true, stationName: true }],
};

export const LAUNCH_READINESS_SHAPE: FieldShape = {
  missionId: true,
  missionStatus: true,
  canLaunch: true,
  summary: { total: true, passed: true, failed: true, warnings: true },
  checks: [{ key: true, label: true, passed: true, blocking: true, status: true }],
};

export const POD_FILES_SHAPE: FieldShape = {
  files: [{ id: true, originalName: true, mime: true, sizeBytes: true, uploadedAt: true }],
};

/** Solde carte : seul le prix de référence est lu par le formulaire de plein, le montant n'est pas affiché. */
export const FUEL_CARD_BALANCE_SHAPE: FieldShape = {
  averagePricePerLiter: true,
  averagePricePerLiterUsed: true,
  averagePricePerLiterReal: true,
  averagePricePerLiterFallback: true,
  priceSource: true,
};
