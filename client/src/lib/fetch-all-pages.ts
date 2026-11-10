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

/** Pourquoi la lecture a été refusée : pour les logs, jamais affiché. */
export interface ReportRefusalDetail {
  path: string;
  reason: "http" | "shape" | "total-changed" | "missing-id" | "incomplete" | "too-many";
  /** Statut HTTP de la réponse en échec (`reason: "http"`). */
  status?: number;
  offset?: number;
  total?: number;
  received?: number;
}

/** Refus de rapport : le message est destiné à l'utilisateur, `detail` aux logs. */
export class ReportRefusedError extends Error {
  readonly detail?: ReportRefusalDetail;
  constructor(message: string, detail?: ReportRefusalDetail) {
    super(message);
    this.name = "ReportRefusedError";
    this.detail = detail;
  }
}

/** Contexte de log d'un échec de rapport : l'erreur, et le détail du refus s'il y en a un. */
export function reportErrorContext(error: unknown): Record<string, unknown> {
  return error instanceof ReportRefusedError && error.detail ? { err: error, refusal: error.detail } : { err: error };
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
    const offset = page * pageSize;
    const response = await fetchFn(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    if (!response.ok) throw new ReportRefusedError(unreadable, { path, reason: "http", status: response.status, offset });
    const body = (await response.json()) as Record<string, unknown> | null;
    const list = body?.[listKey];
    if (!body || !Array.isArray(list) || typeof body.total !== "number") {
      throw new ReportRefusedError(unreadable, { path, reason: "shape", offset });
    }
    if (total === null) {
      total = body.total;
      if (total > limit) {
        throw new ReportRefusedError(tooMany(total.toLocaleString("fr-FR"), limit.toLocaleString("fr-FR")), {
          path,
          reason: "too-many",
          total,
        });
      }
    } else if (body.total !== total) {
      // Ligne créée ou supprimée pendant la lecture : les pages ne décrivent plus la même liste.
      throw new ReportRefusedError(unreadable, { path, reason: "total-changed", offset, total, received: body.total });
    }
    for (const item of list as T[]) {
      const id = (item as { id?: unknown } | null)?.id;
      if (id === undefined || id === null) {
        throw new ReportRefusedError(unreadable, { path, reason: "missing-id", offset });
      }
      byId.set(id, item);
    }
    if ((page + 1) * pageSize >= total || list.length === 0) break;
  }

  // Page vide avant `total`, élément répété ou sauté : liste incomplète.
  if (total === null || byId.size !== total) {
    throw new ReportRefusedError(unreadable, { path, reason: "incomplete", total: total ?? undefined, received: byId.size });
  }
  return [...byId.values()];
}

/** `GET /api/vehicles` plafonne à 1000 par appel (`VEHICLE_LIST_MAX_LIMIT`). */
export const VEHICLES_PAGE_SIZE = 1000;

export function fetchAllVehicles<T = any>(
  fetchFn: FetchLike = defaultFetch,
  {
    pageSize = VEHICLES_PAGE_SIZE,
    maxPages = REPORT_MAX_PAGES,
    unreadable = "Les véhicules n'ont pas pu être lus en entier : le rapport n'a pas été généré. Réessayez.",
    tooMany = (total: string, limit: string) =>
      `Trop de véhicules pour un seul rapport (${total}, limite ${limit}) : le rapport n'a pas été généré.`,
  }: {
    pageSize?: number;
    maxPages?: number;
    unreadable?: string;
    tooMany?: (total: string, limit: string) => string;
  } = {},
): Promise<T[]> {
  return fetchAllPages<T>(fetchFn, { path: "/api/vehicles", listKey: "vehicles", pageSize, maxPages, unreadable, tooMany });
}

/** `GET /api/parts` plafonne à 1000 par appel (`Math.min(rawLimit, 1000)`). */
export const PARTS_PAGE_SIZE = 1000;

/** Catalogue de pièces complet (10 par défaut sans `limit`). */
export function fetchAllParts<T = any>(
  fetchFn: FetchLike = defaultFetch,
  { pageSize = PARTS_PAGE_SIZE, maxPages = REPORT_MAX_PAGES } = {},
): Promise<T[]> {
  return fetchAllPages<T>(fetchFn, {
    path: "/api/parts",
    listKey: "parts",
    pageSize,
    maxPages,
    unreadable: "Les pièces n'ont pas pu être lues en entier. Réessayez.",
    tooMany: (total, limit) => `Trop de pièces à afficher (${total}, limite ${limit}).`,
  });
}

/** `GET /api/tires` n'a pas de plafond serveur : pages de 500, comme les OT. */
export const TIRES_PAGE_SIZE = 500;

/** Stock de pneus complet (20 par défaut sans `limit`). */
export function fetchAllTires<T = any>(
  fetchFn: FetchLike = defaultFetch,
  { pageSize = TIRES_PAGE_SIZE, maxPages = REPORT_MAX_PAGES } = {},
): Promise<T[]> {
  return fetchAllPages<T>(fetchFn, {
    path: "/api/tires",
    listKey: "tires",
    pageSize,
    maxPages,
    unreadable: "Le stock de pneus n'a pas pu être lu en entier. Réessayez.",
    tooMany: (total, limit) => `Trop de pneus à afficher (${total}, limite ${limit}).`,
  });
}

export interface FetchUnpaginatedListOptions {
  path: string;
  /** Message de refus pour une lecture en échec ou une réponse qui n'est pas une liste. */
  unreadable: string;
  /** Borne facultative : au-delà, refus avec `tooMany`. */
  maxItems?: number;
  tooMany?: (total: string, limit: string) => string;
}

/**
 * Liste non paginée par l'API (tableau rendu en entier) : une lecture en échec ne devient
 * jamais `[]`, et un volume au-delà de la borne refuse le rapport.
 */
export async function fetchUnpaginatedList<T = any>(
  fetchFn: FetchLike,
  { path, unreadable, maxItems, tooMany }: FetchUnpaginatedListOptions,
): Promise<T[]> {
  const response = await fetchFn(path);
  if (!response.ok) throw new ReportRefusedError(unreadable, { path, reason: "http", status: response.status });
  const body = await response.json();
  if (!Array.isArray(body)) throw new ReportRefusedError(unreadable, { path, reason: "shape" });
  if (maxItems !== undefined && body.length > maxItems) {
    throw new ReportRefusedError(
      (tooMany ?? (() => unreadable))(body.length.toLocaleString("fr-FR"), maxItems.toLocaleString("fr-FR")),
      { path, reason: "too-many", total: body.length },
    );
  }
  return body as T[];
}

/**
 * `GET /api/fuel-records` rend une liste non paginée. Une lecture en échec ne doit pas devenir
 * `[]` : un rapport de carburant à 0 litre et 0 FCFA est un faux chiffre.
 */
export function fetchFuelRecords<T = any>(fetchFn: FetchLike = defaultFetch): Promise<T[]> {
  return fetchUnpaginatedList<T>(fetchFn, {
    path: "/api/fuel-records",
    unreadable: "Les pleins de carburant n'ont pas pu être lus : le rapport n'a pas été généré. Réessayez.",
  });
}

/** Borne des utilisateurs d'un rapport, alignée sur celle des OT (500 × 20 pages). */
export const REPORT_MAX_USERS = 10_000;

/**
 * `GET /api/users` ne pagine pas (`getAllUsers` sans limite) : la liste est complète, mais son
 * volume n'est pas borné. Au-delà de `REPORT_MAX_USERS`, refus plutôt qu'un rapport ingérable.
 */
export function fetchAllUsers<T = any>(
  fetchFn: FetchLike = defaultFetch,
  { maxItems = REPORT_MAX_USERS } = {},
): Promise<T[]> {
  return fetchUnpaginatedList<T>(fetchFn, {
    path: "/api/users",
    unreadable: "Les utilisateurs n'ont pas pu être lus : le rapport n'a pas été généré. Réessayez.",
    maxItems,
    tooMany: (total, limit) =>
      `Trop d'utilisateurs pour un seul rapport (${total}, limite ${limit}) : le rapport n'a pas été généré.`,
  });
}
