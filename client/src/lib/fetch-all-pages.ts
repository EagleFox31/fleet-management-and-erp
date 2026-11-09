/**
 * Lectures complètes pour les rapports.
 *
 * Les listes de l'API sont paginées (`limit` / `offset`, réponse `{ <liste>, total }`). Un seul
 * appel ne rendait qu'une partie des lignes, et un rapport sur une partie présentait des totaux
 * faux sans le dire. On lit donc page par page jusqu'à `total`, et on refuse le rapport plutôt
 * que de le produire sur une liste incomplète : page en échec, forme invalide, page vide avant
 * le total, élément répété ou sauté d'une page à l'autre, total qui change en cours de lecture,
 * ou volume au-delà de la borne.
 */

/** Refus de rapport : le message est destiné à l'utilisateur. */
export class ReportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRefusedError";
  }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const defaultFetch: FetchLike = (url) => fetch(url);

/** Borne de lecture commune : au-delà, le rapport est refusé au lieu de boucler. */
export const REPORT_MAX_PAGES = 20;

export interface FetchAllPagesOptions {
  /** Chemin de la liste, avec ou sans paramètres (`limit` et `offset` sont ajoutés). */
  path: string;
  /** Clé de la liste dans la réponse (`workOrders`, `vehicles`…). */
  listKey: string;
  pageSize: number;
  maxPages?: number;
  /** Message de refus pour une lecture incomplète. */
  unreadable: string;
  /** Message de refus au-delà de la borne, avec le total et la limite déjà formatés. */
  tooMany: (total: string, limit: string) => string;
}

export async function fetchAllPages<T = any>(
  fetchFn: FetchLike,
  { path, listKey, pageSize, maxPages = REPORT_MAX_PAGES, unreadable, tooMany }: FetchAllPagesOptions,
): Promise<T[]> {
  const limit = pageSize * maxPages;
  const separator = path.includes("?") ? "&" : "?";
  // Par id : un élément répété d'une page à l'autre ne compte qu'une fois, et l'écart avec
  // `total` révèle alors l'élément sauté au lieu de le masquer.
  const byId = new Map<unknown, T>();
  let total: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchFn(`${path}${separator}limit=${pageSize}&offset=${page * pageSize}`);
    if (!response.ok) throw new ReportRefusedError(unreadable);
    const body = (await response.json()) as Record<string, unknown> | null;
    const list = body?.[listKey];
    if (!body || !Array.isArray(list) || typeof body.total !== "number") {
      throw new ReportRefusedError(unreadable);
    }
    if (total === null) {
      total = body.total;
      if (total > limit) {
        throw new ReportRefusedError(tooMany(total.toLocaleString("fr-FR"), limit.toLocaleString("fr-FR")));
      }
    } else if (body.total !== total) {
      // Ligne créée ou supprimée pendant la lecture : les pages ne décrivent plus la même liste.
      throw new ReportRefusedError(unreadable);
    }
    for (const item of list as T[]) {
      const id = (item as { id?: unknown } | null)?.id;
      if (id === undefined || id === null) throw new ReportRefusedError(unreadable);
      byId.set(id, item);
    }
    if ((page + 1) * pageSize >= total || list.length === 0) break;
  }

  // Page vide avant `total`, élément répété ou sauté : liste incomplète.
  if (total === null || byId.size !== total) throw new ReportRefusedError(unreadable);
  return [...byId.values()];
}

/** `GET /api/vehicles` plafonne à 1000 par appel (`VEHICLE_LIST_MAX_LIMIT`). */
export const VEHICLES_PAGE_SIZE = 1000;

export function fetchAllVehicles<T = any>(
  fetchFn: FetchLike = defaultFetch,
  { pageSize = VEHICLES_PAGE_SIZE, maxPages = REPORT_MAX_PAGES } = {},
): Promise<T[]> {
  return fetchAllPages<T>(fetchFn, {
    path: "/api/vehicles",
    listKey: "vehicles",
    pageSize,
    maxPages,
    unreadable: "Les véhicules n'ont pas pu être lus en entier : le rapport n'a pas été généré. Réessayez.",
    tooMany: (total, limit) =>
      `Trop de véhicules pour un seul rapport (${total}, limite ${limit}) : le rapport n'a pas été généré.`,
  });
}

/**
 * `GET /api/fuel-records` rend une liste non paginée. Une lecture en échec ne doit pas devenir
 * `[]` : un rapport de carburant à 0 litre et 0 FCFA est un faux chiffre.
 */
export async function fetchFuelRecords<T = any>(fetchFn: FetchLike = defaultFetch): Promise<T[]> {
  const unreadable = "Les pleins de carburant n'ont pas pu être lus : le rapport n'a pas été généré. Réessayez.";
  const response = await fetchFn("/api/fuel-records");
  if (!response.ok) throw new ReportRefusedError(unreadable);
  const body = await response.json();
  if (!Array.isArray(body)) throw new ReportRefusedError(unreadable);
  return body as T[];
}
