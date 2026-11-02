import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import * as schema from "../../../../shared/schema";

/**
 * Analyse statique des routes d'écriture (POST/PUT/PATCH/DELETE) de `server/routes.ts` et de
 * `server/api/*.routes.ts`, pour les cliquets T1 (garde de rôle), T3 (validation du corps) et
 * T4 (champs serveur) de docs/qa/PLAN_COUVERTURE_MODULES.md.
 *
 * Pas de base, pas d'import du serveur : on lit les sources.
 */

export const serverDir = fileURLToPath(new URL("../../../../server", import.meta.url));

export interface WriteRoute {
  /** `post /api/vehicles` : clé stable, utilisée dans les listes gelées. */
  key: string;
  method: string;
  path: string;
  /** Middlewares de la déclaration (hors `authenticate`), au premier niveau de parenthèses. */
  middlewares: string[];
  /** Routeur monté derrière un garde de rôle (`apiRouter.use("/x", isStaff, xRoutes)`). */
  mountGuarded: boolean;
  /** Texte du handler : de la déclaration jusqu'à la déclaration suivante du même fichier. */
  body: string;
  /** Source complète du fichier (pour retrouver un schéma local). */
  fileSource: string;
  /** Fichier de la déclaration servie (`routes.ts`, `api/x.routes.ts`), renseigné par `allWriteRoutes`. */
  file?: string;
}

/**
 * Préfixe de montage et garde de rôle au montage, par identifiant de routeur (`vehiclesRoutes`)
 * ET par fichier pour un export par défaut (`api/vehicles.routes.ts`) : un fichier peut
 * exporter plusieurs routeurs montés différemment (`work-order-items.routes.ts`).
 */
export function mountPrefixes(indexSource: string): Map<string, { prefix: string; guarded: boolean }> {
  const fileOf = new Map<string, string>();
  for (const m of indexSource.matchAll(/import\s+(\w+)\s+from\s+"\.\/([\w.-]+)"/g)) fileOf.set(m[1], `api/${m[2]}.ts`);
  const prefixes = new Map<string, { prefix: string; guarded: boolean }>();
  for (const m of indexSource.matchAll(/apiRouter\.use\(([^;]*?)\);/gs)) {
    const args = m[1];
    const prefix = args.match(/^\s*"([^"]*)"/)?.[1] ?? "";
    for (const name of args.match(/\b\w+Routes\b/g) ?? []) {
      const file = fileOf.get(name) ?? name;
      const before = args
        .slice(0, args.indexOf(name))
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n && !n.startsWith('"'));
      prefixes.set(file, { prefix: `/api${prefix}`, guarded: before.some((n) => n !== "authenticate") });
    }
  }
  return prefixes;
}

/** Découpe `a, b(c, d), e` au premier niveau. */
function topLevelSplit(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (depth < 0) break;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** Position de la parenthèse qui ferme l'appel en cours (profondeur 0 dépassée), -1 si absente. */
function closingParen(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if ("([{".includes(text[i])) depth++;
    if (")]}".includes(text[i]) && --depth < 0) return i;
  }
  return -1;
}

const HEAD =
  /\b(\w*(?:app|[rR]outer|Routes))\.(get|post|put|patch|delete)\(\s*(?:"([^"]+)"|`([^`]+)`|(relative\(\w+(?:\([^)]*\))?\)))\s*,/g;

/** Routes d'écriture d'un source. `prefix` et `mountGuarded` viennent de `mountPrefixes`. */
export function writeRoutesOf(
  source: string,
  mounts: (routerVar: string) => { prefix: string; guarded: boolean } = () => ({ prefix: "", guarded: false }),
): WriteRoute[] {
  const heads = [...source.matchAll(HEAD)];
  const routes: WriteRoute[] = [];
  heads.forEach((m, i) => {
    const method = m[2];
    if (method === "get") return;
    const declared = m[3] ?? m[4] ?? `<${m[5]}>`;
    const { prefix, guarded: mountGuarded } = mounts(m[1]);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? source.length) : source.length;
    const text = source.slice(start, end);
    // Fin de l'en-tête : première fonction (`async`, `(req`, `(_req`) de la déclaration.
    const fn = text.search(/\basync\b\s*(?:function\s*)?\(|\(\s*_?req\b|\(\s*request\b/);
    // Fin de l'appel `router.post(...)` : si elle précède la première fonction inline, le handler
    // est passé par référence et c'est le dernier élément de la liste.
    const close = closingParen(text);
    const byReference = close >= 0 && (fn < 0 || close < fn);
    const header = byReference ? text.slice(0, close) : fn >= 0 ? text.slice(0, fn) : "";
    const path = declared.startsWith("/api/") ? declared : `${prefix}${declared === "/" ? "" : declared}`;
    if (!path.startsWith("/api")) throw new Error(`Routeur non monté sous /api : ${method} ${path} (${m[1]}) ; compléter mountPrefixes.`);
    routes.push({
      key: `${method} ${path}`,
      method,
      path,
      middlewares: (byReference ? topLevelSplit(header).slice(0, -1) : topLevelSplit(header)).filter((x) => x !== "authenticate"),
      mountGuarded,
      body: text.slice(fn >= 0 ? fn : 0),
      fileSource: source,
    });
  });
  return routes;
}

/**
 * Fichiers de routeurs dans l'ordre de montage de `server/api/index.ts` (`apiRouter.use`), le
 * premier montage de chaque fichier. Express sert dans cet ordre.
 */
export function mountOrder(indexSource: string): string[] {
  const fileOf = new Map<string, string>();
  for (const m of indexSource.matchAll(/import\s+(\w+)\s+from\s+"\.\/([\w.-]+)"/g)) fileOf.set(m[1], `api/${m[2]}.ts`);
  const order: string[] = [];
  for (const m of indexSource.matchAll(/apiRouter\.use\(([^;]*?)\);/gs)) {
    for (const name of m[1].match(/\b\w+Routes\b/g) ?? []) {
      const file = fileOf.get(name);
      if (file && !order.includes(file)) order.push(file);
    }
  }
  return order;
}

/**
 * Déclaration qui ne sert pas la requête : un garde posé avant la vraie route, qui rend la main
 * par `next()` sans jamais répondre (`admin-users-guard.routes.ts`). Elle ne masque pas la
 * déclaration suivante ; ses middlewares (`isAdmin`...) s'ajoutent à celle-ci.
 */
export function isPassThrough(r: WriteRoute): boolean {
  return /\bnext\s*\(/.test(r.body) && !/(?<![\w_])res\.(?:json|status|send|end|sendStatus|redirect|download|sendFile)\b/.test(r.body);
}

/**
 * Routes d'écriture telles que l'application les sert. `server/app.ts` monte `apiRouter` AVANT
 * `registerRoutes` (`server/routes.ts`), et `apiRouter` sert ses routeurs dans l'ordre de
 * `server/api/index.ts` : à clé égale, la première déclaration dans cet ordre gagne, les suivantes
 * ne sont jamais atteintes.
 */
export function allWriteRoutes(): WriteRoute[] {
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  const prefixes = mountPrefixes(indexSource);
  const mounted = mountOrder(indexSource);
  const apiFiles = readdirSync(join(serverDir, "api"))
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => `api/${f}`);
  const files = [
    ...mounted.filter((f) => apiFiles.includes(f)),
    ...apiFiles.filter((f) => !mounted.includes(f)),
    "routes.ts",
  ];
  const byKey = new Map<string, WriteRoute>();
  const guardsOf = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(join(serverDir, f), "utf8");
    const mounts = (v: string) => prefixes.get(v) ?? prefixes.get(f) ?? { prefix: "", guarded: false };
    for (const r of writeRoutesOf(src, mounts)) {
      if (isPassThrough(r)) {
        guardsOf.set(r.key, [...(guardsOf.get(r.key) ?? []), ...r.middlewares]);
      } else if (!byKey.has(r.key)) {
        byKey.set(r.key, { ...r, file: f, middlewares: [...(guardsOf.get(r.key) ?? []), ...r.middlewares] });
      }
    }
  }
  return [...byKey.values()];
}

/* ---------------------------------------------------------------- T1 */

/** Routes ouvertes par conception (connexion, déconnexion) : hors cliquet T1. */
export const PUBLIC_BY_DESIGN = new Set(["post /api/auth/login", "post /api/auth/pin-login", "post /api/auth/logout"]);

/**
 * Middlewares qui ne décident pas du rôle : authentification seule (`authenticate` ne connaît pas
 * le rôle, `isAnyUser` charge l'utilisateur sans le restreindre), drapeau de fonctionnalité,
 * téléversement.
 */
const NOT_A_ROLE_GUARD = /^(?:authenticate|requireAuth|checkAuth|isAnyUser|feature|requireFeature\(|upload\b)/;

/** T1 : un garde de rôle ou de permission dans la déclaration, ou un garde au montage du routeur. */
export function hasRoleGuard(r: WriteRoute): boolean {
  return r.mountGuarded || r.middlewares.some((m) => !NOT_A_ROLE_GUARD.test(m));
}

/* ---------------------------------------------------------------- T3 / T4 */

const READS_BODY = /\breq\.body\b|\brequest\.body\b/;

/** Une route d'écriture qui lit un corps de requête (DELETE exclu). */
export function readsBody(r: WriteRoute): boolean {
  return r.method !== "delete" && READS_BODY.test(r.body);
}

const VALIDATION = /\.(?:safeParse|parse|parseAsync)\(|\bprepareColumnUpdate\(|\bcolumnTypeErrors\(|\bvalidate\w*\(/;

/** T3 : le corps passe par Zod ou par `prepareColumnUpdate` / `columnTypeErrors`, dans le handler ou en middleware. */
export function validatesBody(r: WriteRoute): boolean {
  return VALIDATION.test(r.body) || r.middlewares.some((m) => /valid|schema/i.test(m));
}

export const SERVER_FIELDS = [
  "id",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "recordedBy",
  "approvedBy",
  "requestedBy",
  "receivedBy",
  "issuedBy",
  "totalAmount",
  "cost",
] as const;
const SERVER_FIELD_ALT = SERVER_FIELDS.join("|");

function exportedSchemaIsClean(name: string): boolean | undefined {
  const value = (schema as Record<string, unknown>)[name] as { shape?: Record<string, unknown> } | undefined;
  if (!value || typeof value !== "object" || !value.shape) return undefined;
  return !SERVER_FIELDS.some((f) => f in value.shape!);
}

/** Texte de la définition d'un schéma local `const nom = z.object({...})`. */
function localSchemaDefinition(source: string, name: string): string | undefined {
  const at = source.search(new RegExp(`\\bconst\\s+${name}\\s*=\\s*z\\.`));
  if (at < 0) return undefined;
  const rest = source.slice(at);
  const stop = rest.search(/\n(?:const|let|function|export|router|app|async)\b/);
  return stop > 0 ? rest.slice(0, stop) : rest;
}

const ACTOR_OVERWRITE = new RegExp(
  "\\b(?:createdBy|updatedBy|recordedBy|requestedBy|receivedBy|issuedBy|approvedBy)\\s*:\\s*(?:req\\.user|user|userId|currentUser|actor)",
);
const FIELD_STRIP = new RegExp(`delete\\s+\\w+(?:\\.\\w+)*\\.(?:${SERVER_FIELD_ALT})\\b`);
const SERVER_FIELD_KEY = new RegExp(`\\b(?:${SERVER_FIELD_ALT})\\s*:`);

/**
 * T4 : les champs que seul le serveur écrit ne passent pas du corps à la base. Vrai si
 *  - le handler valide avec un schéma exporté de `shared/schema` qui ne les expose pas, ou un
 *    schéma local `z.object` qui ne les déclare pas ;
 *  - ou il les écrase / les retire explicitement (`createdBy: req.user.id`, `delete body.updatedBy`) ;
 *  - ou il ne retient que des champs nommés (`const { a, b } = req.body`).
 */
export function protectsServerFields(r: WriteRoute): boolean {
  const names = [...new Set([...r.body.matchAll(/\b([A-Za-z]\w*Schema)\b/g)].map((m) => m[1]))];
  for (const n of names) {
    const exported = exportedSchemaIsClean(n);
    if (exported === true) return true;
    if (exported === undefined) {
      const def = localSchemaDefinition(r.fileSource, n);
      if (def && !SERVER_FIELD_KEY.test(def)) return true;
    }
  }
  return ACTOR_OVERWRITE.test(r.body) || FIELD_STRIP.test(r.body) || /const\s*\{[^}=]*\}\s*=\s*req\.body/.test(r.body);
}
