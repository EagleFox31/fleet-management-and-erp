import { isApiError, userMessageOf } from "@/lib/api-error";

/** `forbidden` : 403 ; `notFound` : 404 ou réponse vide ; `failed` : réseau, 5xx ou autre erreur. */
export type VehicleUnavailableKind = "forbidden" | "notFound" | "failed";

export interface VehicleUnavailable {
  kind: VehicleUnavailableKind;
  title: string;
  message: string;
  /** Vrai quand relancer le chargement a un sens (erreur passagère). */
  retryable: boolean;
}

const NOT_FOUND_MESSAGE = "Le véhicule que vous recherchez n'existe pas ou a été supprimé.";
const FORBIDDEN_FALLBACK = "Vous n'avez pas accès à ce véhicule.";
const FAILED_FALLBACK = "Chargement impossible, réessayez.";

/**
 * Écran affiché quand la fiche véhicule ne se charge pas. Seul un 404 (ou une réponse vide)
 * dit « n'existe pas » : un 403 (hors périmètre, #255) ou une panne réseau / 5xx (#261) n'est pas
 * une disparition du véhicule. Pour une 5xx, `userMessageOf` porte la référence (requestId).
 */
export function vehicleUnavailable(error: unknown): VehicleUnavailable {
  if (isApiError(error, 403)) {
    return { kind: "forbidden", title: "Accès refusé", message: userMessageOf(error, FORBIDDEN_FALLBACK), retryable: false };
  }
  if (!error || isApiError(error, 404)) {
    return { kind: "notFound", title: "Véhicule non trouvé", message: NOT_FOUND_MESSAGE, retryable: false };
  }
  return { kind: "failed", title: "Chargement impossible", message: userMessageOf(error, FAILED_FALLBACK), retryable: true };
}
