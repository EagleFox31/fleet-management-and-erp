import { VEHICLE_EDIT_ROLES, VEHICLE_RESTRICTED_PATCH_FIELDS, canWriteVehiclePurchasePrice } from "@shared/constants/roles";
import { AppError } from "./app-error";

export const VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE =
  "Votre rôle ne peut pas renseigner ni modifier le prix d'achat du véhicule.";

/**
 * Un rôle hors VEHICLE_PURCHASE_PRICE_WRITE_ROLES qui envoie la clé `purchasePrice` avec une valeur
 * est refusé (403). Une valeur vide, nulle ou à 0 est retirée avant par `withoutEmptyPurchasePrice`.
 * Rend l'erreur à transmettre à `next()`, ou null.
 */
export function vehiclePriceWriteRefusal(role: string | null | undefined, body: unknown): AppError | null {
  if (canWriteVehiclePurchasePrice(role)) return null;
  if (body && typeof body === "object" && "purchasePrice" in (body as Record<string, unknown>)) {
    return new AppError(403, VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE);
  }
  return null;
}

/** Valeur « pas de prix » : absente, nulle, vide ou égale à 0 (l'assistant d'acquisition envoie 0 par défaut). */
export function isEmptyPurchasePrice(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" || (Number.isFinite(Number(text)) && Number(text) === 0);
  }
  return false;
}

/**
 * Pour un rôle sans droit d'écriture du prix, retire `purchasePrice` quand il est vide, nul ou à 0 :
 * le reste de la requête passe. Une valeur non nulle reste dans le corps et sera refusée en 403.
 * Rend une copie, le corps d'origine n'est pas modifié.
 */
export function withoutEmptyPurchasePrice<T>(role: string | null | undefined, body: T): T {
  if (canWriteVehiclePurchasePrice(role)) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!("purchasePrice" in record) || !isEmptyPurchasePrice(record.purchasePrice)) return body;
  const { purchasePrice: _dropped, ...rest } = record;
  return rest as T;
}

const FIELD_LABELS: Record<string, string> = {
  tankCapacityL: "la capacité des réservoirs",
  purchasePrice: "le prix d'achat",
};

/** Message du 403 pour un rôle restreint : liste ce que son rôle peut renseigner. */
export function vehicleRestrictedPatchMessage(role: string | null | undefined): string {
  const fields = VEHICLE_RESTRICTED_PATCH_FIELDS[String(role ?? "")] ?? [];
  if (fields.length === 0) return "Votre rôle ne peut pas modifier le véhicule.";
  return `Votre rôle peut seulement renseigner ${fields.map((f) => FIELD_LABELS[f] ?? f).join(" et ")} du véhicule.`;
}

/**
 * Les rôles hors VEHICLE_EDIT_ROLES qui atteignent le PATCH véhicule (logistique, secrétariat) ne
 * peuvent envoyer que les champs de VEHICLE_RESTRICTED_PATCH_FIELDS. Toute autre clé, ou un corps vide,
 * est refusé. Rend l'erreur à transmettre à `next()`, ou null si la modification est permise.
 */
export function vehiclePatchRefusal(role: string | null | undefined, body: unknown): AppError | null {
  if ((VEHICLE_EDIT_ROLES as readonly string[]).includes(String(role ?? ""))) return null;
  const allowed = VEHICLE_RESTRICTED_PATCH_FIELDS[String(role ?? "")] ?? [];
  const keys = body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : [];
  if (keys.length > 0 && keys.every((key) => allowed.includes(key))) return null;
  return new AppError(403, vehicleRestrictedPatchMessage(role));
}
