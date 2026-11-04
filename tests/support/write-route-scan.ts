import fs from "node:fs";
import path from "node:path";

/** Scanner des routes d'écriture sans garde de rôle déclarée (voir tests/unit/server/write-route-guards.test.ts). */
export const API_DIR = path.resolve(process.cwd(), "server/api");

/** Receveur Express : `router`, `xxxRouter` ou `xxxRoutes` (work-order-items.routes.ts). */
export const WRITE_ROUTE = /\b(router|\w+Router|\w+Routes)\.(post|put|patch|delete)\(/g;
/**
 * Compte grossier, indépendant du receveur, pour détecter un scanner devenu aveugle.
 * Les requêtes Drizzle (`db.delete(`, `tx\n  .delete(`) ne sont pas des routes : le receveur
 * `db` / `tx` / `trx` est exclu, y compris séparé du point par des espaces ou un saut de ligne.
 * `\b` garde les identifiants qui finissent seulement par ces lettres (`ctx.delete(` compte).
 */
export const ANY_WRITE_CALL = /(?<!\b(?:db|tx|trx)\s*)\.(post|put|patch|delete)\(/g;
const PATH_ARG = /^\s*(["'`])([^"'`]+)\1/;
/** Premier handler : ce qui suit n'est plus un middleware déclaré sur la route. */
const HANDLER_START = /async\s*\(|async\s+function\b|\(\s*req\b/;
/**
 * Garde de rôle : `authorize(...)` ou un middleware `isXxx`.
 * `isAnyUser` charge req.user sans restreindre aucun rôle : il ne compte pas comme garde.
 */
const ROUTE_GUARD = /authorize\(|\b(?!isAnyUser\b)is[A-Z]\w*\b/;

export interface WriteRoute {
  id: string;
  guarded: boolean;
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Arguments de l'appel, de la parenthèse ouvrante à la fermante (déclaration sur plusieurs lignes). */
function callArguments(source: string, from: number): string {
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/** Premier argument tel qu'écrit (chemin littéral ou expression, ex. `relative(ALERT_READ_ALL_PATH)`). */
function firstArgument(args: string): string {
  const literal = PATH_ARG.exec(args);
  if (literal) return literal[2];
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) return args.slice(0, i).replace(/\s+/g, " ").trim();
  }
  return args.replace(/\s+/g, " ").trim();
}

export function apiSources(): Array<{ rel: string; source: string }> {
  return listFiles(API_DIR).map((file) => ({
    rel: path.relative(API_DIR, file).split(path.sep).join("/"),
    source: fs.readFileSync(file, "utf8"),
  }));
}

export function findWriteRoutes(): WriteRoute[] {
  return apiSources().flatMap(({ rel, source }) => findWriteRoutesIn(rel, source));
}

/** Routes d'écriture déclarées dans un source (testable sur un extrait). */
export function findWriteRoutesIn(rel: string, source: string): WriteRoute[] {
  return [...source.matchAll(WRITE_ROUTE)].map((match) => {
    const args = callArguments(source, match.index! + match[0].length);
    const routePath = firstArgument(args);
    // Plusieurs routeurs dans un fichier (work-order-items.routes.ts) : le receveur distingue les routes.
    const receiver = match[1] === "router" ? "" : ` (${match[1]})`;
    // Seuls les middlewares déclarés avant le handler comptent.
    const declaration = args.split(HANDLER_START)[0];
    return {
      id: `${rel} ${match[2].toUpperCase()} ${routePath}${receiver}`,
      guarded: ROUTE_GUARD.test(declaration),
    };
  });
}

export function findUnguardedWriteRoutes(): string[] {
  return findWriteRoutes()
    .filter((route) => !route.guarded)
    .map((route) => route.id)
    .sort();
}

/** Nombre d'appels `.post(` / `.put(` / `.patch(` / `.delete(` dans server/api, quel que soit le receveur. */
export function countAnyWriteCalls(): number {
  return apiSources().reduce((n, { source }) => n + countAnyWriteCallsIn(source), 0);
}

/** Compte grossier sur un extrait (testable). */
export function countAnyWriteCallsIn(source: string): number {
  return source.match(ANY_WRITE_CALL)?.length ?? 0;
}
