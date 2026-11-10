/**
 * Liste blanche de champs du cache hors ligne du chauffeur (cache minimal, decision 7 de V5b).
 * Regle : le cache ne contient rien de plus que ce que l'ecran chauffeur lit
 * (`client/src/pages/driver/dashboard.tsx` : sa fiche, ses missions, le prix du litre).
 * Logique pure. Une forme dit ce qui est garde : `true` pour une valeur simple, un objet pour
 * un sous-objet, `[forme]` pour un tableau. Toute cle absente de la forme est retiree, a
 * n'importe quelle profondeur ; une valeur de type inattendu est retiree aussi.
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

/** Chemins de cles d'une forme (`a.b`, `a[].b`) : sert d'instantane de ce que le cache peut contenir. */
export function shapeKeyPaths(shape: FieldShape, prefix = ""): string[] {
  if (shape === true) return [];
  if (Array.isArray(shape)) return shapeKeyPaths(shape[0], `${prefix}[]`);
  return Object.entries(shape).flatMap(([key, sub]) => [`${prefix}.${key}`, ...shapeKeyPaths(sub, `${prefix}.${key}`)]);
}

/** Missions de `/api/drivers/me` : exactement l'interface `Mission` du tableau de bord chauffeur. */
export const DRIVER_ME_MISSION_SHAPE: FieldShape = {
  id: true,
  orderNumber: true,
  status: true,
  pickupAddress: true,
  pickupDate: true,
  deliveryAddress: true,
  deliveryDate: true,
  actualDeliveryDate: true,
  actualDepartureDate: true,
  estimatedDistance: true,
  actualDistance: true,
  specialInstructions: true,
  clientName: true,
  vehicleRegistration: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleId: true,
};

export const DRIVER_ME_SHAPE: FieldShape = {
  driver: { id: true, firstName: true, lastName: true },
  missions: [DRIVER_ME_MISSION_SHAPE],
};

/** Solde carte : seul le prix de reference est lu par le formulaire de plein, le montant n'est pas affiche. */
export const FUEL_CARD_BALANCE_SHAPE: FieldShape = {
  averagePricePerLiter: true,
  averagePricePerLiterUsed: true,
  averagePricePerLiterReal: true,
  averagePricePerLiterFallback: true,
  priceSource: true,
};

/** Toutes les formes persistees par le profil chauffeur, par requete. */
export const DRIVER_CACHE_SHAPES: Readonly<Record<string, FieldShape>> = {
  "/api/drivers/me": DRIVER_ME_SHAPE,
  "/api/fuel-card/balance": FUEL_CARD_BALANCE_SHAPE,
};
