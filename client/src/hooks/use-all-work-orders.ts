import { useQuery } from "@tanstack/react-query";
import { defaultFetch } from "@/lib/fetch-all-pages";
import { fetchAllWorkOrders } from "@/lib/fetch-all-work-orders";

/**
 * Tous les ordres de travail visibles par l'utilisateur, pour un écran.
 *
 * `GET /api/work-orders` sans `limit` ne rend que 50 OT : un écran qui y cherchait « l'OT
 * ouvert de ce véhicule » ne voyait pas un OT plus ancien. Toutes les pages sont lues, et une
 * lecture incomplète est une erreur (jamais une liste partielle).
 *
 * Clé sous le préfixe `/api/work-orders` : les invalidations existantes s'appliquent.
 */
export const ALL_WORK_ORDERS_QUERY_KEY = ["/api/work-orders", "all"] as const;

/** Relecture au plus toutes les 30 s : jusqu'à 20 pages par lecture. */
export const ALL_WORK_ORDERS_STALE_TIME = 30_000;

export const ALL_WORK_ORDERS_UNREADABLE = "Les ordres de travail n'ont pas pu être lus en entier. Réessayez.";

export function fetchAllWorkOrdersForScreen<T = any>(): Promise<T[]> {
  return fetchAllWorkOrders<T>(defaultFetch, {
    unreadable: ALL_WORK_ORDERS_UNREADABLE,
    tooMany: (total, limit) => `Trop d'ordres de travail à afficher (${total}, limite ${limit}).`,
  });
}

export function useAllWorkOrders<T = any>({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<T[]>({
    queryKey: ALL_WORK_ORDERS_QUERY_KEY,
    queryFn: () => fetchAllWorkOrdersForScreen<T>(),
    staleTime: ALL_WORK_ORDERS_STALE_TIME,
    enabled,
  });
}
