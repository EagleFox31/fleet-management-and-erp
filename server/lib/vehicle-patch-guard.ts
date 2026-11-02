import { VEHICLE_EDIT_ROLES } from "@shared/constants/roles";
import { AppError } from "./app-error";

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
