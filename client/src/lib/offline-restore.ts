import type { QueryClient } from "@tanstack/react-query";

export interface RestorableQuery {
  queryKey: readonly unknown[];
  state: { data: unknown; dataUpdatedAt?: unknown };
}

/**
 * Remet en cache les lectures relues d'IndexedDB, sans jamais ecraser une donnee plus recente
 * deja en memoire. Une copie restauree est une copie, pas une lecture fraiche : elle est
 * marquee perimee (`invalidateQueries`) pour que l'ecran la relise des que le reseau repond.
 * Sans cela, une copie reduite (missions en cours ou livrees seulement) resterait affichee
 * comme a jour pendant `staleTime`. Hors ligne, la relecture attend et la copie reste visible.
 * Renvoie le nombre de requetes restaurees.
 */
export function applyRestoredQueries(queryClient: QueryClient, items: readonly RestorableQuery[]): number {
  let restored = 0;
  for (const item of items) {
    if (queryClient.getQueryData(item.queryKey) !== undefined) continue;
    queryClient.setQueryData(item.queryKey, item.state.data, {
      updatedAt: typeof item.state.dataUpdatedAt === "number" ? item.state.dataUpdatedAt : undefined,
    });
    void queryClient.invalidateQueries({ queryKey: item.queryKey, exact: true });
    restored++;
  }
  return restored;
}
