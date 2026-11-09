import { useQuery } from "@tanstack/react-query";
import { defaultFetch, fetchAllVehicles } from "@/lib/fetch-all-pages";

/**
 * Flotte complète pour un écran (libellés, filtres, alertes, export).
 *
 * `GET /api/vehicles` sans `limit` ne rend que 10 véhicules (`VEHICLE_LIST_DEFAULT_LIMIT`) :
 * un écran qui lisait `["/api/vehicles"]` calculait ses alertes, ses libellés ou son export sur
 * les 10 plus récents sans le dire. Ici, toutes les pages sont lues, et une lecture incomplète
 * est une erreur (jamais une liste partielle).
 *
 * Clé sous le préfixe `/api/vehicles` : les invalidations existantes (temps réel, mutations)
 * s'appliquent. Second élément `"all"` et `queryFn` explicite : jamais servie par le `queryFn`
 * par défaut.
 */
export const ALL_VEHICLES_QUERY_KEY = ["/api/vehicles", "all"] as const;

/** Relecture au plus toutes les 30 s : jusqu'à 20 pages par lecture. */
export const ALL_VEHICLES_STALE_TIME = 30_000;

export const ALL_VEHICLES_UNREADABLE = "Les véhicules n'ont pas pu être lus en entier. Réessayez.";

export function useAllVehicles<T = any>({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<T[]>({
    queryKey: ALL_VEHICLES_QUERY_KEY,
    queryFn: () =>
      fetchAllVehicles<T>(defaultFetch, {
        unreadable: ALL_VEHICLES_UNREADABLE,
        tooMany: (total, limit) => `Trop de véhicules à afficher (${total}, limite ${limit}).`,
      }),
    staleTime: ALL_VEHICLES_STALE_TIME,
    enabled,
  });
}
