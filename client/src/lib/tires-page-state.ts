/**
 * État d'affichage de /inventory/tires selon ses deux requêtes bloquantes : la liste des pneus
 * et les statistiques de l'en-tête.
 *
 * Une requête en échec affiche une erreur lisible, jamais une page vide ni des zéros qui
 * passeraient pour de vraies valeurs.
 */
export interface TiresQueryStatus {
  isLoading: boolean;
  error: unknown;
}

export type TiresPageState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready" };

export function tiresPageState(tires: TiresQueryStatus, stats: TiresQueryStatus): TiresPageState {
  if (tires.isLoading || stats.isLoading) return { kind: "loading" };
  const error = tires.error ?? stats.error;
  if (error) return { kind: "error", error };
  return { kind: "ready" };
}
