import { useQuery } from "@tanstack/react-query";
import { defaultFetch, fetchAllParts } from "@/lib/fetch-all-pages";

/**
 * Catalogue de pièces complet pour un écran. `GET /api/parts` sans `limit` ne rend que 10 pièces :
 * toutes les pages sont lues, une lecture incomplète est une erreur (jamais une liste partielle).
 * Clé sous le préfixe `/api/parts` : les invalidations existantes s'appliquent.
 */
export const ALL_PARTS_QUERY_KEY = ["/api/parts", "all"] as const;

export function useAllParts<T = any>({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<T[]>({
    queryKey: ALL_PARTS_QUERY_KEY,
    queryFn: () => fetchAllParts<T>(defaultFetch),
    staleTime: 30_000,
    enabled,
  });
}
