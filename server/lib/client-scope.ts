import { AppError } from "./app-error";

/**
 * Cloison entre clients.
 *
 * Le personnel (tout rôle sauf `client`) accède à tous les véhicules et à leurs
 * documents, pour un contrôle ou pour un travail. Un client n'accède qu'aux
 * véhicules dont il est propriétaire (`vehicles.ownerId`) et aux sessions
 * d'acquisition qu'il a créées (`vehicle_acquisition_workflows.user_id`).
 *
 * Objet isolé hors périmètre : 403. Liste : filtrée sur le propriétaire.
 */

export type ScopeReader = { id: number; role: string };

export const OUT_OF_SCOPE_MESSAGE = "Accès refusé : ce véhicule n'appartient pas à votre compte.";

/** Propriétaire imposé aux lectures, ou `null` quand rien n'est cloisonné. */
export function ownerScopeOf(reader: ScopeReader | undefined): number | null {
  if (!reader) {
    throw new AppError(401, "Non authentifié.");
  }
  return reader.role === "client" ? reader.id : null;
}

/**
 * Vrai si `reader` peut accéder à l'objet. `ownerOf` n'est appelé que pour un
 * client : le personnel ne coûte aucune lecture. Sans utilisateur : refusé.
 */
export async function canAccessOwned(
  reader: ScopeReader | undefined,
  ownerOf: () => Promise<number | null | undefined>,
): Promise<boolean> {
  if (!reader) return false;
  const scope = ownerScopeOf(reader);
  return scope === null || (await ownerOf()) === scope;
}
