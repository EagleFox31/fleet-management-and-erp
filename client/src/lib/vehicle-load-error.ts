import { isApiError, userMessageOf } from "@/lib/api-error";

export interface VehicleUnavailable {
  forbidden: boolean;
  title: string;
  message: string;
}

const NOT_FOUND_MESSAGE = "Le véhicule que vous recherchez n'existe pas ou a été supprimé.";
const FORBIDDEN_FALLBACK = "Vous n'avez pas accès à ce véhicule.";

/**
 * Écran affiché quand la fiche véhicule ne se charge pas. Un 403 (véhicule hors du périmètre
 * d'un client) n'est pas un 404 : dire « n'existe pas » serait faux et trompeur.
 */
export function vehicleUnavailable(error: unknown): VehicleUnavailable {
  if (isApiError(error, 403)) {
    return { forbidden: true, title: "Accès refusé", message: userMessageOf(error, FORBIDDEN_FALLBACK) };
  }
  return { forbidden: false, title: "Véhicule non trouvé", message: NOT_FOUND_MESSAGE };
}
