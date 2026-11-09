/**
 * Chiffres du tableau de bord secrétaire (/secretary/dashboard).
 *
 * Chaque chiffre vaut `null` quand sa lecture a échoué ou qu'une de ses sources est illisible :
 * l'écran affiche alors « Indisponible », jamais 0 (pas de chiffre d'affaires, de solde ni de
 * document à renouveler inventé).
 */
import type { QueryView } from "@/lib/query-view";
import { statField, sumField, sumKnown } from "@/lib/stat-number";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";

/** Pendant le premier chargement : ni 0 ni « Indisponible ». */
export const LOADING_VALUE = "…";

/** Donnée d'une vue prête, `null` sinon. */
export function viewData<T>(view: QueryView<T>): T | null {
  return view.kind === "ready" ? view.data : null;
}

/**
 * Texte d'un chiffre : « … » pendant le chargement, « Indisponible » si la lecture a échoué ou
 * si la valeur est illisible, sinon la valeur (formatée si demandé).
 */
export function statDisplay(
  view: QueryView<unknown>,
  value: number | null,
  format?: (value: number) => string,
): string | number {
  if (view.kind === "loading") return LOADING_VALUE;
  if (view.kind === "error" || value === null) return UNAVAILABLE;
  return format ? format(value) : value;
}

/** Phrase d'un compte : « … » pendant le chargement, `unavailable` si inconnu. */
export function countSentence(
  view: QueryView<unknown>,
  value: number | null,
  sentence: (value: number) => string,
  unavailable: string,
): string {
  if (view.kind === "loading") return LOADING_VALUE;
  return view.kind === "error" || value === null ? unavailable : sentence(value);
}

/** Vrai seulement pour un compte connu et non nul (couleur d'alerte). */
export function isPositive(value: number | null): boolean {
  return value !== null && value > 0;
}

export interface DocumentRenewals {
  expiringSoon: number | null;
  expired: number | null;
  toRenew: number | null;
}

const DOCUMENT_TYPES = ["CarteGrise", "Assurance", "VisiteTechnique"] as const;

/** `GET /api/vehicles/document-stats` : carte grise, assurance, visite technique. */
export function documentRenewals(stats: unknown): DocumentRenewals {
  const expiringSoon = sumKnown(DOCUMENT_TYPES.map((type) => statField(stats, `expiring${type}`)));
  const expired = sumKnown(DOCUMENT_TYPES.map((type) => statField(stats, `expired${type}`)));
  return { expiringSoon, expired, toRenew: sumKnown([expiringSoon, expired]) };
}

export interface ClientTotals {
  missions: number | null;
  /** Somme des carburants estimés des missions (servie sous le nom `totalRevenue`). */
  estimatedFuelCost: number | null;
  fuelCost: number | null;
}

/**
 * `GET /api/operations/stats/by-client`.
 * - Le coût servi par client est `totalFuelCost` (carburant réel des missions) : l'ancien écran
 *   lisait un champ absent de la réponse et affichait 0.
 * - `totalRevenue` n'est pas un chiffre d'affaires : la route y somme les `estimatedFuelCost`.
 *   Il est exposé comme coût carburant estimé ; aucune marge n'en est tirée.
 */
export function clientTotals(list: readonly unknown[] | null): ClientTotals {
  return {
    missions: sumField(list, "totalMissions"),
    estimatedFuelCost: sumField(list, "totalRevenue"),
    fuelCost: sumField(list, "totalFuelCost"),
  };
}
