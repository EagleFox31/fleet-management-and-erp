import { VEHICLE_EDIT_ROLES, canWriteVehiclePurchasePrice } from "@shared/constants/roles";
import { AppError } from "./app-error";

export const VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE =
  "Votre rôle ne peut pas renseigner ni modifier le prix d'achat du véhicule.";

/**
 * Un rôle hors VEHICLE_PURCHASE_PRICE_WRITE_ROLES qui envoie la clé `purchasePrice` est refusé
 * (403), la clé n'est pas ignorée en silence. Rend l'erreur à transmettre à `next()`, ou null.
 */
export function vehiclePriceWriteRefusal(role: string | null | undefined, body: unknown): AppError | null {
  if (canWriteVehiclePurchasePrice(role)) return null;
  if (body && typeof body === "object" && "purchasePrice" in (body as Record<string, unknown>)) {
    return new AppError(403, VEHICLE_PURCHASE_PRICE_WRITE_MESSAGE);
  }
  return null;
}

export const VEHICLE_TANK_CAPACITY_ONLY_MESSAGE =
  "Votre rôle peut seulement renseigner la capacité des réservoirs du véhicule.";

/**
 * Les rôles hors VEHICLE_EDIT_ROLES qui atteignent le PATCH véhicule (la logistique) ne
 * peuvent envoyer que `tankCapacityL`. Toute autre clé, ou un corps sans cette clé, est refusé.
 * Rend l'erreur à transmettre à `next()`, ou null si la modification est permise.
 */
export function vehiclePatchRefusal(role: string | null | undefined, body: unknown): AppError | null {
  if ((VEHICLE_EDIT_ROLES as readonly string[]).includes(String(role ?? ""))) return null;
  const keys = body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : [];
  if (keys.length === 1 && keys[0] === "tankCapacityL") return null;
  return new AppError(403, VEHICLE_TANK_CAPACITY_ONLY_MESSAGE);
}
