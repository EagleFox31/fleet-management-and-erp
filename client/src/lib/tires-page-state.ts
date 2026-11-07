/**
 * État d'affichage de /inventory/tires selon ses deux requêtes bloquantes : la liste des pneus
 * et les statistiques de l'en-tête.
 *
 * - Une requête en échec affiche une erreur lisible, jamais une page vide ni des zéros qui
 *   passeraient pour de vraies valeurs.
 * - Seule une requête **sans données** est en erreur : une relance qui échoue (temps réel, pool
 *   saturé) garde les données déjà affichées, la liste et ses dialogues ouverts.
 * - Statistiques en échec : encart sur les indicateurs, la liste reste visible.
 */
export interface TiresQueryStatus {
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  data: unknown;
}

export interface TiresQueryFailure {
  error: unknown;
  /** Un nouvel essai est en cours : le bouton « Réessayer » est désactivé. */
  isRetrying: boolean;
}

export type TiresPageState =
  | { kind: "loading" }
  | ({ kind: "error" } & TiresQueryFailure)
  | { kind: "ready"; statsError: TiresQueryFailure | null };

function failureWithoutData(query: TiresQueryStatus): unknown {
  return query.data === undefined ? query.error : null;
}

export function tiresPageState(tires: TiresQueryStatus, stats: TiresQueryStatus): TiresPageState {
  if (tires.isLoading || stats.isLoading) return { kind: "loading" };

  const tiresError = failureWithoutData(tires);
  if (tiresError) {
    return { kind: "error", error: tiresError, isRetrying: tires.isFetching || stats.isFetching };
  }

  const statsError = failureWithoutData(stats);
  return {
    kind: "ready",
    statsError: statsError ? { error: statsError, isRetrying: stats.isFetching } : null,
  };
}
