import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { extractRoutes, matchingClose, parseMounts, sourceFiles, stripComments } from "./route-guard-scan";

/**
 * Croise les URL des `queryKey` du client avec les routes GET servies par le serveur (#280).
 *
 * Le `queryFn` par défaut (`client/src/lib/queryClient.ts`) prend `queryKey[0]` comme URL : une clé
 * qui ne correspond à aucune route part en 404, que TanStack réessaie à chaque montage. Le cas
 * d'origine : `useWarehouse` interrogeait `/api/parts/by-supplier`, la route est
 * `/api/warehouse/parts-by-supplier`.
 *
 * Limites assumées : seules les clés littérales (chaîne ou gabarit) qui commencent par `/api/` sont
 * vues. Un segment `${...}` vaut n'importe quel segment. Côté serveur, seuls les routeurs montés dans
 * `server/api/index.ts` et les `app.get` de `server/routes.ts` sont connus : une route servie
 * autrement apparaît comme manquante, et se règle par la liste gelée, avec sa justification.
 * L'union des routes ne modélise pas l'ordre de service ni le masquage (AGENTS.md §9) : un futur
 * `/:id` de `server/api/`, monté avant `routes.ts`, qui capturerait un littéral de `routes.ts` serait
 * compté comme servi et donnerait un faux vert ici. Ce masquage relève de `route-order-scan.ts`.
 */

const PARAM = ":p";

/** Chemins GET servis, en segments (`:p` pour un paramètre). */
export function servedGetPaths(serverDir: string): string[][] {
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  const mounts = parseMounts(indexSource, { restrictive: new Set(), permissive: new Set(), neutral: new Set(), arrays: new Map(), roles: {} });
  const paths = new Set<string>();
  const apiDir = join(serverDir, "api");
  for (const path of sourceFiles(apiDir)) {
    const file = path.slice(apiDir.length + 1).replace(/\\/g, "/").replace(/\.ts$/, "");
    const fileMounts = mounts.filter((m) => m.file === file);
    if (fileMounts.length === 0) continue;
    const source = readFileSync(path, "utf8");
    for (const route of extractRoutes(source)) {
      if (route.method !== "get") continue;
      const own = fileMounts.filter((m) => m.variable === route.routerVar);
      // variable inconnue : rattacher à tous les montages du fichier (faux négatif plutôt que faux positif)
      for (const mount of own.length > 0 ? own : fileMounts) paths.add(`/api${mount.prefix}${route.path}`);
    }
    // squelettes `createStubRouter([{ method: "get", path: "/" }])` (server/api/stub.ts) : servis en 501, pas en 404
    if (/\bcreateStubRouter\s*\(/.test(source)) {
      for (const m of stripComments(source).matchAll(/\{\s*method\s*:\s*["']get["']\s*,\s*path\s*:\s*["']([^"']+)["']/g)) {
        for (const mount of fileMounts) paths.add(`/api${mount.prefix}${m[1]}`);
      }
    }
  }
  for (const route of extractRoutes(readFileSync(join(serverDir, "routes.ts"), "utf8"))) {
    if (route.method === "get" && route.routerVar === "app") paths.add(route.path);
  }
  return [...paths].map(toSegments);
}

function toSegments(path: string): string[] {
  return path
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.startsWith(":") || segment.includes("${") ? PARAM : segment.replace(/\?$/, "")));
}

/**
 * - `fetch` : requête servie par le `queryFn` par défaut, l'URL doit être une route.
 * - `prefix` : invalidation, lecture ou écriture de cache (`invalidateQueries`...), la clé doit être
 *   le préfixe d'au moins une route.
 * Une clé dont l'objet porte son propre `queryFn` n'est pas retenue : l'URL appelée est ailleurs.
 */
export type QueryKeyUse = { file: string; url: string; mode: "fetch" | "prefix" };

const CACHE_CALL = /(?:invalidateQueries|refetchQueries|cancelQueries|removeQueries|resetQueries|setQueryData|setQueriesData|getQueryData|getQueriesData|getQueryState|isFetching|isMutating|ensureQueryData)\s*\(\s*$/;

/** Accolade ouvrante de l'objet qui contient `at` (recherche arrière naïve, suffisante pour un objet d'options). */
function enclosingObjectStart(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** `queryKey: ["/api/..."` littérales du client (premier élément du tableau). */
export function extractQueryKeyUrls(file: string, rawSource: string): QueryKeyUse[] {
  const source = stripComments(rawSource);
  const out: QueryKeyUse[] = [];
  for (const m of source.matchAll(/\bqueryKey\s*:\s*\[\s*(["'`])(\/api\/[^"'`]*)\1/g)) {
    const open = enclosingObjectStart(source, m.index! - 1);
    const close = open === -1 ? -1 : matchingClose(source, open);
    const object = open === -1 || close === -1 ? "" : source.slice(open, close + 1);
    const mode = open !== -1 && CACHE_CALL.test(source.slice(Math.max(0, open - 80), open)) ? "prefix" : "fetch";
    if (mode === "fetch" && /\bqueryFn\s*[:,(]/.test(object)) continue;
    out.push({ file, url: m[2].split("?")[0], mode });
  }
  return out;
}

export function matchesServed(use: Pick<QueryKeyUse, "url" | "mode">, served: string[][]): boolean {
  const key = toSegments(use.url);
  return served.some(
    (route) =>
      (use.mode === "prefix" ? route.length >= key.length : route.length === key.length) &&
      // un paramètre de route n'accepte qu'un segment dynamique ou numérique : `/api/parts/by-supplier`
      // atteint bien `/api/parts/:id` à l'exécution, mais pour y répondre 404 (cas d'origine, #280)
      key.every((segment, i) => segment === PARAM || segment === route[i] || (route[i] === PARAM && /^\d+$/.test(segment))),
  );
}

/** Clés sans route, en `fichier url` triés et dédoublonnés. */
export function scanUnservedQueryKeys(clientDir: string, serverDir: string, root: string): string[] {
  const served = servedGetPaths(serverDir);
  const misses = new Set<string>();
  for (const path of sourceFiles(clientDir).concat(sourceFilesTsx(clientDir))) {
    const file = path.slice(root.length + 1).replace(/\\/g, "/");
    for (const use of extractQueryKeyUrls(file, readFileSync(path, "utf8"))) {
      // une invalidation sans route ne part pas en requête : seul le `fetch` produit un 404
      if (use.mode === "fetch" && !matchesServed(use, served)) misses.add(`${use.file} ${use.url}`);
    }
  }
  return [...misses].sort();
}

function sourceFilesTsx(dir: string): string[] {
  // sourceFiles ne retient que les .ts : les écrans sont en .tsx
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFilesTsx(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}
