/**
 * État d'affichage d'une requête TanStack, pour ne jamais présenter une panne comme un vrai vide.
 *
 * - `ready` dès que des données existent, même si la dernière relance a échoué : des données en
 *   cache restent affichées (même règle que `tiresPageState`, #591).
 * - `error` seulement pour une requête en échec **sans données** : l'écran affiche un message
 *   lisible et « Réessayer », jamais « Aucun… » ni un 0.
 * - `loading` sinon (premier chargement, ou requête désactivée).
 */
export interface QueryStatus<T> {
  data: T | undefined;
  error: unknown;
  isFetching: boolean;
}

export type QueryView<T> =
  | { kind: "loading" }
  | { kind: "error"; error: unknown; /** Un nouvel essai est en cours : « Réessayer » est désactivé. */ isRetrying: boolean }
  | { kind: "ready"; data: T };

export function queryView<T>(query: QueryStatus<T>): QueryView<T> {
  if (query.data !== undefined) return { kind: "ready", data: query.data };
  if (query.error) return { kind: "error", error: query.error, isRetrying: query.isFetching };
  return { kind: "loading" };
}

/**
 * `queryView` pour une liste : une réponse 200 qui n'est pas une liste est une erreur
 * (sinon l'écran resterait sur « Chargement… » sans fin). L'erreur vaut `null` :
 * `userMessageOf` affiche alors le message de repli.
 */
export function listQueryView<T>(query: QueryStatus<unknown>): QueryView<T[]> {
  if (query.data !== undefined && !Array.isArray(query.data)) {
    return { kind: "error", error: null, isRetrying: query.isFetching };
  }
  return queryView(query as QueryStatus<T[]>);
}

/** Données si la vue est prête, sinon `fallback` (à n'utiliser que là où l'erreur est déjà affichée). */
export function readyData<T, F>(view: QueryView<T>, fallback: F): T | F {
  return view.kind === "ready" ? view.data : fallback;
}
