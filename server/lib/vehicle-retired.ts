import { AppError } from "./app-error";

/**
 * Véhicule retiré de la flotte (suppression douce, `deleted_at` renseigné) :
 * - le personnel continue de le lire (liens depuis l'historique, restauration) ;
 * - un client ne le voit plus, même s'il en est propriétaire : détail, contrôle d'immatriculation et
 *   sous-ressources (documents, kilométrage, historique de statut, pneus : `canReadVehicleSubresources`) ;
 * - personne ne le modifie avant de l'avoir restauré (POST /api/vehicles/:id/restore).
 * Le filtre vit ici, pas dans `storage.getVehicle` : la cloison des OT d'un client
 * (work-order-scope.ts) et les contrôles de doublon d'immatriculation doivent voir les véhicules retirés.
 */
export const VEHICLE_RETIRED_EDIT_MESSAGE = "Véhicule retiré : le restaurer avant de le modifier.";

type MaybeRetired = { deletedAt?: Date | string | null } | null | undefined;

export const isRetiredVehicle = (vehicle: MaybeRetired): boolean => vehicle?.deletedAt != null;

/** Le véhicule tel que ce rôle peut le lire en détail ; undefined si un client vise un véhicule retiré. */
export function vehicleReadableBy<T extends MaybeRetired>(role: string | null | undefined, vehicle: T): T | undefined {
  return role === "client" && isRetiredVehicle(vehicle) ? undefined : vehicle;
}

/** Refus (409) de modifier un véhicule retiré, null sinon : la route le passe à `next`. */
export function vehicleEditRefusal(vehicle: MaybeRetired): AppError | null {
  return isRetiredVehicle(vehicle) ? new AppError(409, VEHICLE_RETIRED_EDIT_MESSAGE) : null;
}

/**
 * Lecture des sous-ressources d'un véhicule (documents, kilométrage, historique de statut, pneus) :
 * le personnel lit tout ; un client, seulement son véhicule et tant qu'il n'est pas retiré.
 * `loadVehicle` n'est appelé que pour un client : le personnel ne coûte aucune lecture.
 */
export async function canReadVehicleSubresources(
  reader: { id: number; role: string } | undefined,
  loadVehicle: () => Promise<{ ownerId: number | null; deletedAt: Date | string | null } | undefined>,
): Promise<boolean> {
  if (!reader) return false;
  if (reader.role !== "client") return true;
  const vehicle = await loadVehicle();
  return vehicle?.ownerId === reader.id && !isRetiredVehicle(vehicle);
}
