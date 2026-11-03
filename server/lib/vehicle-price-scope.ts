import { canReadVehiclePurchasePrice } from "@shared/constants/roles";

/**
 * Prix d'achat d'un véhicule : lisible par admin, logistique et secrétariat seulement
 * (`VEHICLE_PURCHASE_PRICE_READ_ROLES`, décision du 3 novembre 2026).
 *
 * Forme unique : pour un lecteur non autorisé la clé reste présente et vaut `null`. Les écrans
 * qui lisent `vehicle.purchasePrice` reçoivent donc « pas de valeur », jamais une clé absente
 * qui casserait un type ou un tri.
 *
 * Un lecteur absent (`undefined`) est traité comme non autorisé : échec fermé.
 */

export type PriceReader = { role?: string | null } | null | undefined;

export function canReadPurchasePrice(reader: PriceReader): boolean {
  return canReadVehiclePurchasePrice(reader?.role);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Un véhicule porte `registrationNumber` ; une fiche pneu, elle aussi dotée d'un `purchasePrice`, non.
 * Limite : une projection qui ne prendrait que `purchasePrice` (sans l'immatriculation) n'est pas
 * reconnue et ne serait pas masquée. Garde-fou : tests/unit/server/vehicle-select-hygiene.test.ts
 * gèle les lectures entières de `vehicles` et impose de les déclarer.
 */
function isVehicleLike(value: Record<string, unknown>): boolean {
  return "purchasePrice" in value && "registrationNumber" in value;
}

/** Véhicule seul : copie sans prix d'achat pour un lecteur non autorisé, objet d'origine sinon. */
export function redactVehiclePrice<T>(reader: PriceReader, vehicle: T): T {
  if (canReadPurchasePrice(reader)) return vehicle;
  if (!isPlainObject(vehicle) || !("purchasePrice" in vehicle)) return vehicle;
  return { ...vehicle, purchasePrice: null } as T;
}

/**
 * Tableaux et objets imbriqués (`{ vehicle }` d'une mission, `{ vehicles: [...] }` d'une page,
 * `{ vehicle }` d'une affectation, trame temps réel). Tout objet qui ressemble à un véhicule
 * (`purchasePrice` + `registrationNumber`) est expurgé, quelle que soit sa profondeur. Les dates et
 * les autres instances sont laissées intactes ; l'entrée n'est jamais modifiée.
 */
export function redactVehiclePriceDeep<T>(reader: PriceReader, value: T): T {
  if (canReadPurchasePrice(reader)) return value;
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = walk(child);
  if (isVehicleLike(next)) next.purchasePrice = null;
  return next;
}
