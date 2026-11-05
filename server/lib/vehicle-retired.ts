import { AppError } from "./app-error";

/**
 * Véhicule retiré de la flotte (suppression douce, `deleted_at` renseigné) :
 * - le personnel continue de le lire (liens depuis l'historique, restauration) ;
 * - un client ne le voit plus en détail ni au contrôle d'immatriculation, même s'il en est propriétaire
 *   (les sous-ressources documents, kilométrage, historique de statut et pneus ne filtrent pas encore) ;
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
