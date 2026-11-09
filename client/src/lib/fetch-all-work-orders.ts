/**
 * Lecture complète des ordres de travail pour un rapport.
 *
 * `GET /api/work-orders` est paginé (50 par défaut, 500 au plus) : un seul appel sans
 * `limit` ne rendait que les 50 premiers, et le rapport des coûts de maintenance
 * sous-évaluait le total sans le dire. Lecture page par page par `fetchAllPages`, qui
 * refuse le rapport plutôt que de le produire sur une liste incomplète.
 */
import { defaultFetch, fetchAllPages, type FetchLike, REPORT_MAX_PAGES, ReportRefusedError } from "@/lib/fetch-all-pages";

export { ReportRefusedError };

export const WORK_ORDERS_PAGE_SIZE = 500;
/** Borne de lecture : au-delà, le rapport est refusé au lieu de boucler. */
export const WORK_ORDERS_MAX_PAGES = REPORT_MAX_PAGES;

export function fetchAllWorkOrders<T = any>(
  fetchFn: FetchLike = defaultFetch,
  {
    pageSize = WORK_ORDERS_PAGE_SIZE,
    maxPages = WORK_ORDERS_MAX_PAGES,
    unreadable = "Les ordres de travail n'ont pas pu être lus en entier : le rapport n'a pas été généré. Réessayez.",
    tooMany = (total: string, limit: string) =>
      `Trop d'ordres de travail pour un seul rapport (${total}, limite ${limit}) : le rapport n'a pas été généré.`,
  }: {
    pageSize?: number;
    maxPages?: number;
    unreadable?: string;
    tooMany?: (total: string, limit: string) => string;
  } = {},
): Promise<T[]> {
  return fetchAllPages<T>(fetchFn, { path: "/api/work-orders", listKey: "workOrders", pageSize, maxPages, unreadable, tooMany });
}
