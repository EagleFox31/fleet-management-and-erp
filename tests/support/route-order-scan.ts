import { readFileSync } from "fs";
import { join } from "path";
import { extractRoutes, parseMounts, sourceFiles } from "./route-guard-scan";

/**
 * Route littérale masquée par un paramètre déclaré avant elle (#222).
 *
 * Express sert la **première** route qui correspond. `GET /api/suppliers/:id` déclarée avant
 * `GET /api/suppliers/summary` capture `summary` comme `id` : le littéral ne sert jamais.
 *
 * Ordre de service reconstitué :
 *   1. routeurs de `server/api/`, dans l'ordre de leurs montages `apiRouter.use(...)` de
 *      `server/api/index.ts`, puis l'ordre de déclaration dans chaque fichier ;
 *   2. `server/routes.ts` (`app.*`), servi après `apiRouter` (`server/app.ts`).
 *
 * `A` masque `B` (même méthode, déclarée après) quand les deux chemins ont le même nombre de
 * segments, que chaque segment de `A` est égal à celui de `B` ou est un paramètre simple (`:id`),
 * et qu'au moins un paramètre de `A` fait face à un littéral de `B`. Deux chemins identiques
 * (noms de paramètres ignorés) relèvent du scan des doublons, pas de celui-ci.
 *
 * Limites connues (garde statique, pas une preuve) :
 *   - un handler qui passe la main par `next()` (garde chaînée) est jugé masquant ;
 *   - un paramètre contraint (`:id(\\d+)`), optionnel (`:id?`) ou joker (`*`) n'est pas un paramètre
 *     simple : il n'est jamais jugé masquant ;
 *   - un sous-routeur monté par un autre fichier que `server/api/index.ts`, ou un `app.use` posé avant
 *     `apiRouter`, n'est pas vu ;
 *   - un routeur exporté sans montage connu est ignoré ;
 *   - `router.all` et `router.route()` ne sont pas lus.
 */

export type OrderedRoute = { method: string; path: string; origin: string };

const SIMPLE_PARAM = /^:\w+$/;
const segmentsOf = (path: string) => path.replace(/\/+$/, "").split("/").filter(Boolean);

/** `masker` capture-t-il `masked` (même méthode supposée) ? */
export function masks(masker: string, masked: string): boolean {
  const a = segmentsOf(masker);
  const b = segmentsOf(masked);
  if (a.length !== b.length) return false;
  let capturesLiteral = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (SIMPLE_PARAM.test(a[i])) {
      // deux paramètres face à face : même forme, pas un masquage de littéral
      if (!b[i].startsWith(":")) capturesLiteral = true;
      continue;
    }
    return false;
  }
  return capturesLiteral;
}

/** Littéraux masqués, dans l'ordre de service : `GET /a/lit (origine) <- GET /a/:id (origine)`. */
export function findParamBeforeLiteral(routes: OrderedRoute[]): string[] {
  const hits: string[] = [];
  routes.forEach((route, index) => {
    const masker = routes.slice(0, index).find((earlier) => earlier.method === route.method && masks(earlier.path, route.path));
    if (masker) {
      hits.push(`${route.method.toUpperCase()} ${route.path} (${route.origin}) <- ${masker.method.toUpperCase()} ${masker.path} (${masker.origin})`);
    }
  });
  return hits;
}

/** Toutes les routes servies, dans l'ordre où Express les essaie. */
export function servedRoutesInOrder(serverDir: string): OrderedRoute[] {
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  const mounts = parseMounts(indexSource, { restrictive: new Set(), permissive: new Set(), neutral: new Set(), arrays: new Map(), roles: {} });
  const apiDir = join(serverDir, "api");
  const routesByFile = new Map<string, ReturnType<typeof extractRoutes>>();
  for (const path of sourceFiles(apiDir)) {
    routesByFile.set(path.slice(apiDir.length + 1).replace(/\\/g, "/").replace(/\.ts$/, ""), extractRoutes(readFileSync(path, "utf8")));
  }
  const ordered: OrderedRoute[] = [];
  for (const mount of mounts) {
    if (!mount.file) continue;
    const routes = routesByFile.get(mount.file) ?? [];
    const sameFile = mounts.filter((m) => m.file === mount.file);
    for (const route of routes) {
      // un fichier peut exporter plusieurs routeurs : rattachement par variable, sinon au seul montage
      const own = sameFile.find((m) => m.variable === route.routerVar) ?? (sameFile.length === 1 ? sameFile[0] : undefined);
      if (own !== mount) continue;
      ordered.push({ method: route.method, path: `/api${mount.prefix}${route.path}`, origin: `server/api/${mount.file}.ts` });
    }
  }
  for (const route of extractRoutes(readFileSync(join(serverDir, "routes.ts"), "utf8"))) {
    if (route.routerVar === "app") ordered.push({ method: route.method, path: route.path, origin: "server/routes.ts" });
  }
  return ordered;
}
