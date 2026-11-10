import { VEHICLES_PAGE_SIZE } from "./fetch-all-pages";

/** Taille de la recherche par immatriculation : une page complète, jamais les 50 premiers seulement. */
export const REGISTRATION_LOOKUP_LIMIT = VEHICLES_PAGE_SIZE;

/** Forme comparable d'une immatriculation : sans espaces de bord, sans casse. */
export const registrationKey = (value: string): string => value.trim().toUpperCase();

/**
 * Véhicule dont l'immatriculation correspond exactement (hors casse et espaces de bord) à celle de
 * l'URL. La recherche serveur (`search=`, ilike) est partielle et insensible à la casse : la
 * comparaison côté client doit l'être aussi, sinon `/vehicles/immatriculation/ab-123-cd` ne trouve
 * pas `AB-123-CD`.
 */
export function findVehicleByRegistration<T extends { registrationNumber: string }>(
  vehicles: readonly T[] | undefined,
  registration: string,
): T | undefined {
  const wanted = registrationKey(registration);
  return vehicles?.find((v) => registrationKey(v.registrationNumber) === wanted);
}
