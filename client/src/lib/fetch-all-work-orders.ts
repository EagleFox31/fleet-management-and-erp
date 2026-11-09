/**
 * Lecture complète des ordres de travail pour un rapport.
 *
 * `GET /api/work-orders` est paginé (50 par défaut, 500 au plus) : un seul appel sans
 * `limit` ne rendait que les 50 premiers, et le rapport des coûts de maintenance
 * sous-évaluait le total sans le dire. On lit donc page par page jusqu'à `total`, et on
 * refuse le rapport plutôt que de le produire sur une liste incomplète.
 */
export const WORK_ORDERS_PAGE_SIZE = 500;
/** Borne de lecture : au-delà, le rapport est refusé au lieu de boucler. */
export const WORK_ORDERS_MAX_PAGES = 20;

/** Refus de rapport : le message est destiné à l'utilisateur. */
export class ReportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRefusedError";
  }
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const UNREADABLE = "Les ordres de travail n'ont pas pu être lus en entier : le rapport n'a pas été généré. Réessayez.";

export async function fetchAllWorkOrders<T = any>(
  fetchFn: FetchLike = (url) => fetch(url),
  { pageSize = WORK_ORDERS_PAGE_SIZE, maxPages = WORK_ORDERS_MAX_PAGES } = {},
): Promise<T[]> {
  const limit = pageSize * maxPages;
  const all: T[] = [];
  let total: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchFn(`/api/work-orders?limit=${pageSize}&offset=${page * pageSize}`);
    if (!response.ok) throw new ReportRefusedError(UNREADABLE);
    const body = (await response.json()) as { workOrders?: unknown; total?: unknown } | null;
    if (!body || !Array.isArray(body.workOrders) || typeof body.total !== "number") {
      throw new ReportRefusedError(UNREADABLE);
    }
    if (total === null) {
      total = body.total;
      if (total > limit) {
        throw new ReportRefusedError(
          `Trop d'ordres de travail pour un seul rapport (${total}, limite ${limit.toLocaleString("fr-FR")}) : le rapport n'a pas été généré.`,
        );
      }
    }
    all.push(...(body.workOrders as T[]));
    if (all.length >= total || body.workOrders.length === 0) break;
  }

  // Page vide avant `total`, ou total qui change en cours de lecture : liste incomplète.
  if (total === null || all.length !== total) throw new ReportRefusedError(UNREADABLE);
  return all;
}
