import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTS_PAGE_SIZE, VEHICLES_PAGE_SIZE } from "../../../client/src/lib/fetch-all-pages";
import { WORK_ORDERS_PAGE_SIZE } from "../../../client/src/lib/fetch-all-work-orders";

/**
 * Garde-fou : aucune lecture sans `limit` d'une route paginée par défaut dans `client/src`.
 *
 * Ces routes rendent une seule page quand on ne leur donne pas de `limit` (10 véhicules, 50 OT…).
 * Un écran qui les lisait comme « la liste » s'arrêtait à la première page sans aucun signal :
 * technicien limité aux 10 véhicules récents, OT ouvert d'un vieux véhicule ignoré, échéances
 * jamais affichées. Pire, trois écrans lisaient la réponse `{ <liste>, total }` comme un tableau
 * (dialogue qui plante, tuile à 0, fiche en chargement sans fin).
 *
 * Lire toute la liste : `useAllVehicles` / `useAllWorkOrders` (`client/src/hooks/`), ou
 * `fetchAllPages` (`client/src/lib/fetch-all-pages.ts`). Un compteur : `limit: 1` et `total`.
 *
 * Repères, pour chaque route de `DEFAULT_LIMITS` :
 * - `queryKey: ["<route>"]` lu par `useQuery` (et apparentés) : la requête par défaut appelle la
 *   route sans paramètre. Une invalidation (`invalidateQueries({ queryKey: ["<route>"] })`) n'est
 *   pas une lecture et n'est pas visée.
 * - `fetch("<route>")` ou `apiRequest("GET", "<route>")` sans `?`, hors écriture (`method: "POST"`…).
 *
 * Cliquet : les lecteurs restants sont gelés par fichier ; le compte ne peut que baisser, et une
 * entrée devenue fausse doit être retirée de la liste.
 */

/** Défaut serveur de chaque route sans `limit` (aligné par le second bloc de tests). */
const DEFAULT_LIMITS: Record<string, number> = {
  "/api/vehicles": 10,
  "/api/work-orders": 50,
  "/api/parts": 10,
  "/api/tires": 20,
  "/api/admin/users": 10,
  "/api/tire-inspections": 20,
  "/api/tire-inspections/recent": 10,
  "/api/tire-rotations": 20,
};

const FROZEN: Record<string, number> = {
  // Lot 2b : rotations (la route ignore `limit` et rend tout ; lecture sans `limit` à lever avec la route).
  "client/src/pages/inventory/tires/index.tsx": 1,
};

const ROOT = join(__dirname, "..", "..", "..");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const READ_CALL = /\b(useQuery|useSuspenseQuery|useQueries|useInfiniteQuery|prefetchQuery|fetchQuery|ensureQueryData)\b/g;
const CACHE_CALL =
  /\b(invalidateQueries|refetchQueries|cancelQueries|removeQueries|resetQueries|setQueryData|setQueriesData|getQueryData|getQueriesData|isFetching|getQueryState)\b/g;
const WRITE_METHOD = /^[^)]{0,120}?method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/s;

function lastIndex(re: RegExp, text: string): number {
  let index = -1;
  for (const m of text.matchAll(re)) index = m.index ?? index;
  return index;
}

/**
 * Lectures par constante : `const KEY = ["<route>"]` (ou `= "<route>"`) puis `queryKey: KEY`,
 * `queryKey: [KEY]`, `fetch(KEY)` ou `apiRequest("GET", KEY)`. Une clé de deux éléments ou plus
 * (`["<route>", "all"]`) est paramétrée et n'est pas visée.
 */
function constantKeyReads(src: string): number {
  let count = 0;
  for (const route of Object.keys(DEFAULT_LIMITS)) {
    const decl = new RegExp(
      String.raw`\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*\[?\s*(["'\`])${esc(route)}\2\s*\]?\s*(?:as\s+const)?\s*[;\n]`,
      "g",
    );
    for (const m of src.matchAll(decl)) {
      const name = m[1];
      const use = new RegExp(
        String.raw`queryKey\s*:\s*\[?\s*${name}\s*\]?\s*[,}]|\bfetch\(\s*${name}\s*[,)]|\bapiRequest\(\s*["']GET["']\s*,\s*${name}\s*[,)]`,
        "g",
      );
      for (const u of src.matchAll(use)) {
        const before = src.slice(Math.max(0, (u.index ?? 0) - 400), u.index);
        if (!u[0].startsWith("queryKey") || lastIndex(READ_CALL, before) > lastIndex(CACHE_CALL, before)) count++;
      }
    }
  }
  return count;
}

/** Nombre de lectures sans `limit` des routes à défaut dans un source. */
function defaultPaginatedReads(src: string): number {
  let count = constantKeyReads(src);
  for (const route of Object.keys(DEFAULT_LIMITS)) {
    const key = new RegExp(`queryKey\\s*:\\s*\\[\\s*(["'\`])${esc(route)}\\1\\s*\\]`, "g");
    for (const m of src.matchAll(key)) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
      // Lecture si l'appel englobant le plus proche est un `useQuery` (et non une invalidation).
      if (lastIndex(READ_CALL, before) > lastIndex(CACHE_CALL, before)) count++;
    }
    const call = new RegExp(`(?:\\bfetch\\(\\s*|\\bapiRequest\\(\\s*["']GET["']\\s*,\\s*)(["'\`])${esc(route)}\\1`, "g");
    for (const m of src.matchAll(call)) {
      if (!WRITE_METHOD.test(src.slice((m.index ?? 0) + m[0].length))) count++;
    }
  }
  return count;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("lectures sans limit des routes paginées par défaut (client/src)", () => {
  const found: Record<string, number> = {};
  for (const file of sourceFiles(join(ROOT, "client", "src"))) {
    const count = defaultPaginatedReads(readFileSync(file, "utf8"));
    if (count > 0) found[relative(ROOT, file).split(sep).join("/")] = count;
  }

  it("aucun nouveau lecteur, aucun compte gelé qui augmente", () => {
    const excess = Object.entries(found)
      .filter(([file, count]) => count > (FROZEN[file] ?? 0))
      .map(([file, count]) => `${file} : ${count} (gelé : ${FROZEN[file] ?? 0})`);
    expect(excess).toEqual([]);
  });

  it("cliquet : une entrée gelée corrigée sort de la liste", () => {
    const stale = Object.entries(FROZEN)
      .filter(([file, count]) => (found[file] ?? 0) < count)
      .map(([file, count]) => `${file} : ${found[file] ?? 0} (gelé : ${count})`);
    expect(stale).toEqual([]);
  });

  it("le repère voit les lectures et ignore invalidations, écritures et lectures paramétrées", () => {
    const sample = [
      `useQuery<any>({ queryKey: ["/api/vehicles"] })`, // lu
      `useQuery({\n  queryKey: ['/api/work-orders'],\n  enabled: true,\n})`, // lu
      `fetch("/api/tires")`, // lu
      `apiRequest("GET", "/api/parts")`, // lu
      `queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] })`,
      `useQuery({ queryKey: ["/api/vehicles", { limit: 1 }] })`,
      `useQuery({ queryKey: ["/api/vehicles", "all"], queryFn })`,
      `fetch("/api/vehicles?limit=1")`,
      `fetch('/api/vehicles', { method: 'POST', body })`,
      `apiRequest("POST", "/api/work-orders", data)`,
      `useQuery({ queryKey: ["/api/vehicles/stats"] })`,
    ].join(";\n");
    expect(defaultPaginatedReads(sample)).toBe(4);
  });

  it("le repère voit aussi les lectures par constante, pas les invalidations ni les clés paramétrées", () => {
    const sample = [
      `const VEHICLES_KEY = ["/api/vehicles"];`,
      `const PARTS = "/api/parts";`,
      `const ALL = ["/api/vehicles", "all"] as const;`,
      `useQuery({ queryKey: VEHICLES_KEY })`, // lu
      `useQuery({ queryKey: [PARTS], enabled })`, // lu
      `fetch(PARTS)`, // lu
      `apiRequest("GET", PARTS)`, // lu
      `queryClient.invalidateQueries({ queryKey: VEHICLES_KEY })`,
      `useQuery({ queryKey: ALL, queryFn })`,
    ].join(";\n");
    expect(constantKeyReads(sample)).toBe(4);
  });
});

/**
 * Alignement sur le serveur : la liste ci-dessus ne vaut que si chaque route a toujours ce défaut.
 * Un défaut modifié ou retiré côté serveur doit être reporté ici ; une taille de page au-delà du
 * plafond serveur ferait refuser toute lecture complète.
 */
describe("routes paginées par défaut : alignement sur le serveur", () => {
  const routesSrc = readFileSync(join(ROOT, "server", "routes.ts"), "utf8");
  const vehicleListSrc = readFileSync(join(ROOT, "server", "services", "vehicle-list-service.ts"), "utf8");

  /** Corps du gestionnaire `app.get("<route>", …)` jusqu'à la déclaration suivante. */
  function handler(route: string): string {
    const start = routesSrc.search(new RegExp(`app\\.get\\(\\s*["'\`]${esc(route)}["'\`]`));
    expect(start, `route ${route} absente de server/routes.ts`).toBeGreaterThanOrEqual(0);
    const rest = routesSrc.slice(start + 10);
    const next = rest.search(/\n\s*app\.(get|post|put|patch|delete|use)\(/);
    return rest.slice(0, next < 0 ? undefined : next);
  }
  const defaultOf = (body: string) =>
    Number(body.match(/req\.query\.limit as string\)\s*\|\|\s*["'`]?(\d+)["'`]?/)?.[1] ?? NaN);
  const constant = (src: string, name: string) => Number(src.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1] ?? NaN);

  it("/api/vehicles : VEHICLE_LIST_DEFAULT_LIMIT", () => {
    expect(constant(vehicleListSrc, "VEHICLE_LIST_DEFAULT_LIMIT")).toBe(DEFAULT_LIMITS["/api/vehicles"]);
  });

  for (const route of Object.keys(DEFAULT_LIMITS).filter((r) => r !== "/api/vehicles")) {
    it(`${route} : défaut du gestionnaire`, () => {
      expect(defaultOf(handler(route))).toBe(DEFAULT_LIMITS[route]);
    });
  }

  it("tailles de page des lectures complètes ≤ plafonds serveur", () => {
    expect(VEHICLES_PAGE_SIZE).toBeLessThanOrEqual(constant(vehicleListSrc, "VEHICLE_LIST_MAX_LIMIT"));
    const workOrdersMax = Number(handler("/api/work-orders").match(/Math\.min\(Math\.max\(requestedLimit,\s*1\),\s*(\d+)\)/)?.[1]);
    expect(WORK_ORDERS_PAGE_SIZE).toBeLessThanOrEqual(workOrdersMax);
    const partsMax = Number(handler("/api/parts").match(/Math\.min\(rawLimit,\s*(\d+)\)/)?.[1]);
    expect(PARTS_PAGE_SIZE).toBeLessThanOrEqual(partsMax);
  });
});
