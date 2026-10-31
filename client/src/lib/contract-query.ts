import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ZodTypeAny, z } from "zod";
import { getQueryFn } from "@/lib/queryClient";

type Params = Record<string, string | number | undefined>;

/**
 * Lecture d'une route de contrat : la réponse est validée par le schéma zod du
 * contrat. Clé de requête = `[chemin, params]`, compatible avec le `queryFn`
 * par défaut et avec les invalidations par chemin.
 */
export function useContractQuery<S extends ZodTypeAny>(
  path: string,
  schema: S,
  params?: Params,
  options: Partial<Omit<UseQueryOptions<z.infer<S>>, "queryKey" | "queryFn">> = {},
) {
  const fetcher = getQueryFn<unknown>({ on401: "throw" });
  return useQuery<z.infer<S>>({
    queryKey: params ? [path, params] : [path],
    queryFn: async (ctx) => schema.parse(await fetcher(ctx)),
    ...options,
  });
}
