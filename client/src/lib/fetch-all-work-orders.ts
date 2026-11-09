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
  // Par id : un OT répété d'une page à l'autre (dates de création égales) ne compte qu'une fois,
  // et l'écart avec `total` révèle alors l'OT sauté au lieu de le masquer.
  const byId = new Map<unknown, T>();
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
          `Trop d'ordres de travail pour un seul rapport (${total.toLocaleString("fr-FR")}, limite ${limit.toLocaleString("fr-FR")}) : le rapport n'a pas été généré.`,
        );
      }
    } else if (body.total !== total) {
      // OT créé ou supprimé pendant la lecture : les pages ne décrivent plus la même liste.
      throw new ReportRefusedError(UNREADABLE);
    }
    for (const item of body.workOrders as T[]) {
      const id = (item as { id?: unknown } | null)?.id;
      if (id === undefined || id === null) throw new ReportRefusedError(UNREADABLE);
      byId.set(id, item);
    }
    if ((page + 1) * pageSize >= total || body.workOrders.length === 0) break;
  }

  // Page vide avant `total`, OT répété ou sauté : liste incomplète.
  if (total === null || byId.size !== total) throw new ReportRefusedError(UNREADABLE);
  return [...byId.values()];
}
