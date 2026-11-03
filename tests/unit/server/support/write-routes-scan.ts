import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { SERVER_FIELDS } from "../../../../shared/constants/server-fields";
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
  /** Handler écrit dans la déclaration (`async (req, res) => ...`), et non passé par référence. */
  inline?: boolean;
  /** Handler passé par référence : identifiant du dernier argument (`patchSettings`). */
  handlerRef?: string;
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
      const before = topLevelSplit(args.slice(0, args.indexOf(name)))
        .map((n) => n.replace(/^\s*\/\/[^\n]*\n/gm, "").trim())
        .filter((n) => n && !n.startsWith('"'));
      prefixes.set(file, { prefix: `/api${prefix}`, guarded: before.some((n) => isMountGuard(n)) });
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

/** Début de chaque argument de premier niveau, jusqu'à la parenthèse qui ferme l'appel. */
function topLevelStarts(text: string): number[] {
  const starts = [0];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if ("([{".includes(text[i])) depth++;
    if (")]}".includes(text[i]) && --depth < 0) break;
    if (text[i] === "," && depth === 0) starts.push(i + 1);
  }
  return starts;
}

/** Argument qui ouvre une fonction écrite sur place : `async (req...`, `(req, res) =>`, `function (`. */
const INLINE_FN = /^\s*(?:async\b|function\b|\()/;

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
  // `router.use(garde)` sans chemin : garde toutes les déclarations suivantes de ce routeur.
  const fileGuards = [...source.matchAll(/\b(\w*(?:app|[rR]outer|Routes))\.use\(\s*(\w+)\s*\)/g)]
    .filter((u) => isMountGuard(u[2]))
    .map((u) => ({ router: u[1], at: u.index ?? 0 }));
  const routes: WriteRoute[] = [];
  heads.forEach((m, i) => {
    const method = m[2];
    if (method === "get") return;
    const declared = m[3] ?? m[4] ?? `<${m[5]}>`;
    const mounted = mounts(m[1]);
    const { prefix } = mounted;
    const mountGuarded = mounted.guarded || fileGuards.some((g) => g.router === m[1] && g.at < (m.index ?? 0));
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? source.length) : source.length;
    const text = source.slice(start, end);
    // Fin de l'en-tête : premier ARGUMENT de premier niveau qui est une fonction écrite sur place.
    // Une fonction à l'intérieur d'un argument (`ownedBy((req) => ...)`) ne coupe pas l'en-tête.
    const close = closingParen(text);
    const fn = topLevelStarts(text).find((at) => (close < 0 || at < close) && INLINE_FN.test(text.slice(at))) ?? -1;
    // Aucun argument inline avant la fin de l'appel : handler passé par référence, dernier élément.
    const byReference = close >= 0 && fn < 0;
    const header = byReference ? text.slice(0, close) : fn >= 0 ? text.slice(0, fn) : "";
    const path = declared.startsWith("/api/") ? declared : `${prefix}${declared === "/" ? "" : declared}`;
    if (!path.startsWith("/api")) throw new Error(`Routeur non monté sous /api : ${method} ${path} (${m[1]}) ; compléter mountPrefixes.`);
    const ref = byReference ? topLevelSplit(header).at(-1) : undefined;
    routes.push({
      key: `${method} ${path}`,
      inline: !byReference && fn >= 0,
      handlerRef: ref && /^\w+$/.test(ref) ? ref : undefined,
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
 * Liste POSITIVE des gardes de rôle : seul un nom connu compte. Un middleware inconnu (alias
 * `anyone`, tableau `[isAnyUser]`, spread `...guards`, drapeau de fonctionnalité, téléversement)
 * ne vaut pas garde.
 *
 *  - Exports `is*` de `server/middleware/auth.ts` construits par `authorize(...)` ou `sessionGuard(...)`,
 *    sauf `isAnyUser` (tous les rôles) : lus dans la source, un nouveau garde y est reconnu d'office.
 *  - `authorize([...])` écrit sur place, sauf s'il admet tous les rôles (`ALL_ROLES`).
 *  - Gardes locales, par fichier : chaque nom est vérifié dans son fichier par le test.
 */
export const AUTH_ROLE_GUARDS: ReadonlySet<string> = new Set(
  [
    ...readFileSync(join(serverDir, "middleware", "auth.ts"), "utf8").matchAll(
      /export\s+const\s+(is[A-Z]\w*)\s*(?::\s*\w+\s*)?=\s*(?:authorize|sessionGuard)\(/g,
    ),
  ]
    .map((m) => m[1])
    .filter((n) => n !== "isAnyUser"),
);

/** Gardes définies localement, par fichier servi. */
export const LOCAL_ROLE_GUARDS: Readonly<Record<string, readonly string[]>> = {
  "api/billing.routes.ts": ["canAccessBilling", "canRecordPayment"],
  "api/purchase-orders.routes.ts": ["checkWritePermission", "checkApprovalPermission"],
  "api/supplier-invoices.routes.ts": ["checkCreatePermission", "checkPaymentPermission", "checkAutoApprovePermission"],
  "api/suppliers.routes.ts": ["checkWritePermission", "checkEvaluationPermission", "checkSupplierCreatePermission"],
  "api/time-tracking.routes.ts": ["writers"],
  "api/vehicle-document-types.routes.ts": ["adminOnly"],
};

/** Gardes de montage locales à `server/api/index.ts` (`apiRouter.use("/x", garde, xRoutes)`). */
export const MOUNT_ROLE_GUARDS: readonly string[] = ["gardeApprovisionnement", "...exportsGuard"];

/** `authorize([...])` écrit sur place, qui n'admet pas tous les rôles. */
function isInlineAuthorize(m: string): boolean {
  return /^authorize\(\s*\[/.test(m) && !/\bALL_ROLES\b/.test(m);
}

/** Garde de rôle reconnue dans une déclaration de route. */
export function isRoleGuard(m: string, file?: string): boolean {
  return AUTH_ROLE_GUARDS.has(m) || isInlineAuthorize(m) || (file !== undefined && (LOCAL_ROLE_GUARDS[file] ?? []).includes(m));
}

/** Garde de rôle reconnue au montage d'un routeur. */
function isMountGuard(m: string): boolean {
  return AUTH_ROLE_GUARDS.has(m) || isInlineAuthorize(m) || MOUNT_ROLE_GUARDS.includes(m);
}

/**
 * `selfScoped` admet tous les rôles. Il ne vaut garde que si le handler (inline, ou résolu dans le
 * fichier quand il est passé par référence) n'agit que sur le compte de session :
 *  - il lit `req.user.id` ou `req.session.userId` ;
 *  - il ne lit pas l'URL (`params`, `query`, segment `:x` du chemin) ;
 *  - il ne lit le corps (toute mention de `body`) que derrière `validateBody(schéma)`, schéma non
 *    permissif qui ne déclare ni `*Id`, ni `email`, ni `username` : `validateBody` retire tout champ
 *    non déclaré, un alias ou une déstructuration de `req.body` ne peut donc rien désigner d'autre.
 */
const SELF_SCOPED = /^selfScoped$/;
const SESSION_IDENTITY = /\breq\.user!?\.id\b|\breq\.session\??\.userId\b/;
const URL_TARGET = /\b(?:params|query)\b/;
const BODY_MENTION = /\bbody\b/;
/** Clé de schéma écrite qui désigne un autre compte ou un autre objet. */
const TARGET_KEY = /(?:^|[{,\s])["']?(?:\w*(?:id|Id|ID)|email|username)["']?\s*:/;
const TARGET_FIELD = /(?:id|Id|ID)$|^email$|^username$/;
/** Construction qui cache des clés à l'analyse du texte. */
const OPAQUE_SCHEMA = /\.\.\.|\.(?:extend|merge|and|or|passthrough|catchall)\(|z\.(?:union|intersection|lazy|record|any|unknown)\(/;

/** Le schéma de `validateBody(...)` ne déclare aucune clé de cible (`*Id`, `email`, `username`). Inconnu : faux. */
function schemaHasNoTarget(m: string, fileSource: string): boolean {
  if (validateBodyVerdict(m, fileSource) === "unsafe") return false;
  const arg = topLevelSplit(m.slice(m.indexOf("(") + 1))[0] ?? "";
  if (/^z\.object\(/.test(arg)) return !TARGET_KEY.test(arg) && !OPAQUE_SCHEMA.test(arg);
  if (!/^[A-Za-z]\w*$/.test(arg)) return false;
  const value = (schema as Record<string, unknown>)[arg] as { shape?: Record<string, unknown> } | undefined;
  if (value && typeof value === "object" && value.shape) return !Object.keys(value.shape).some((k) => TARGET_FIELD.test(k));
  const def = localSchemaDefinition(fileSource, arg);
  return def !== undefined && /=\s*z\.object\(/.test(def) && !TARGET_KEY.test(def) && !OPAQUE_SCHEMA.test(def);
}

/** Texte d'un handler passé par référence (`const nom ... = async (...) => {...}` ou `function nom`). */
function referencedHandler(r: WriteRoute): string | undefined {
  if (!r.handlerRef) return undefined;
  const at = r.fileSource.search(new RegExp(`\\bconst\\s+${r.handlerRef}\\b[^=]*=|\\bfunction\\s+${r.handlerRef}\\s*\\(`));
  if (at < 0) return undefined;
  const rest = r.fileSource.slice(at);
  const stop = rest.slice(1).search(/\n(?:const|let|function|export|router|app|async)\b/);
  return stop >= 0 ? rest.slice(0, stop + 1) : rest;
}

/** `selfScoped` tient : handler connu, identité de session lue, ni URL, ni corps hors `validateBody` sûr. */
export function selfScopedHolds(r: WriteRoute): boolean {
  // Identifiant dans le chemin : la cible vient de l'URL, quel que soit le handler.
  if (r.path.includes(":")) return false;
  const handler = r.inline ? r.body : referencedHandler(r);
  if (!handler) return false;
  if (!SESSION_IDENTITY.test(handler) || URL_TARGET.test(handler)) return false;
  if (!BODY_MENTION.test(handler)) return true;
  const validators = r.middlewares.filter((m) => VALIDATE_BODY.test(m));
  return validators.length > 0 && validators.every((m) => schemaHasNoTarget(m, r.fileSource));
}

/** T1 : un garde de rôle reconnu (liste positive) dans la déclaration, ou un garde au montage du routeur. */
export function hasRoleGuard(r: WriteRoute): boolean {
  if (r.mountGuarded) return true;
  return r.middlewares.some((m) => {
    // `selfScoped` admet tous les rôles : il ne vaut garde que si la route n'agit que sur le compte de session.
    if (SELF_SCOPED.test(m)) return selfScopedHolds(r);
    return isRoleGuard(m, r.file);
  });
}

/**
 * Déclarations que l'analyse ne sait pas lire : `.route(...)`, `.all(...)`, chemin entre apostrophes
 * ou en variable, routeur dont le nom n'est pas reconnu (`const r = Router()`). Le test exige zéro :
 * sinon une route échapperait aux cliquets.
 */
export function unreadableDeclarations(source: string): string[] {
  const routers = new Set<string>();
  for (const m of source.matchAll(/\b(\w+)\s*(?::\s*\w+\s*)?=\s*(?:express\.)?Router\(/g)) routers.add(m[1]);
  for (const m of source.matchAll(/\b(\w*(?:app|[rR]outer|Routes))\.(?:get|post|put|patch|delete|route|all)\(/g)) routers.add(m[1]);
  const recognised = new Set([...source.matchAll(HEAD)].map((m) => m.index));
  const out: string[] = [];
  for (const name of routers) {
    if (!/^\w*(?:app|[rR]outer|Routes)$/.test(name)) out.push(`routeur non reconnu : ${name}`);
    for (const m of source.matchAll(new RegExp(`\\b${name}\\.(post|put|patch|delete|route|all)\\(`, "g"))) {
      if (m[1] === "route" || m[1] === "all" || !recognised.has(m.index)) {
        out.push(`déclaration illisible : ${source.slice(m.index, (m.index ?? 0) + 70).split("\n")[0]}`);
      }
    }
  }
  return out;
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
  return VALIDATION.test(r.body) || r.middlewares.some((m) => VALIDATE_BODY.test(m) || /valid|schema/i.test(m));
}

/** Brique `validateBody(schema, options?)` de `server/middleware/validate-body.ts`. */
const VALIDATE_BODY = /^validateBody\(/;
/** Avec `keep` (forme `keep:` ou abrégée `{ keep }`), le schéma passé est analysé comme ailleurs. */
const VALIDATE_BODY_KEEP = /\bkeep\b/;
/** Schéma permissif dans la déclaration : le retrait ne protège plus rien. */
const PERMISSIVE = /\.passthrough\(|\.catchall\(|\bz\.(?:any|unknown|record)\(/;

/**
 * `validateBody(schéma)` vaut T4 seul quand le retrait est garanti : aucun `keep` (y compris abrégé),
 * options absentes ou écrites en littéral sans spread (`opts` variable ou `{ ...opts }` : inconnu),
 * schéma non permissif (y compris sa définition locale).
 */
function validateBodyVerdict(m: string, fileSource: string): "strips" | "analyse" | "unsafe" {
  const args = topLevelSplit(m.slice(m.indexOf("(") + 1));
  if (args.length === 0 || args.length > 2) return "unsafe";
  if (args[1] !== undefined && (!args[1].startsWith("{") || args[1].includes("..."))) return "unsafe";
  if (PERMISSIVE.test(m)) return "unsafe";
  const local = /^([A-Za-z]\w*)/.exec(args[0])?.[1];
  const def = local ? localSchemaDefinition(fileSource, local) : undefined;
  if (def && PERMISSIVE.test(def)) return "unsafe";
  return args[1] !== undefined && VALIDATE_BODY_KEEP.test(args[1]) ? "analyse" : "strips";
}

export { SERVER_FIELDS };
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
 *  - ou il ne retient que des champs nommés (`const { a, b } = req.body`) ;
 *  - ou la déclaration passe par `validateBody(schéma)` sans `keep:` (les champs serveur sont retirés).
 */
export function protectsServerFields(r: WriteRoute): boolean {
  const verdicts = r.middlewares.filter((m) => VALIDATE_BODY.test(m)).map((m) => validateBodyVerdict(m, r.fileSource));
  if (verdicts.includes("unsafe")) return false;
  if (verdicts.includes("strips")) return true;
  const declared = [...r.middlewares.filter((m) => VALIDATE_BODY.test(m)), r.body].join("\n");
  const names = [...new Set([...declared.matchAll(/\b([A-Za-z]\w*Schema)\b/g)].map((m) => m[1]))];
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
