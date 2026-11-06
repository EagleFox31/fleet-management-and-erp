import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Analyse statique des routes GET du serveur, pour le garde-fou de cloison client
 * (`tests/unit/server/routes-hygiene.test.ts`, AGENTS.md §11).
 *
 * Une lecture est « ouverte à un client sans cloison » quand elle porte une garde de session
 * mais aucune garde qui exclut le client, et que son corps ne contrôle ni le propriétaire ni
 * l'OT AVANT d'envoyer la donnée.
 *
 * Échec fermé (lot A4, 3 novembre 2026). Chaque argument de l'en-tête d'une route est classé :
 * - « restrictive » : exclut le client. Seules sont crues les gardes classées d'après leur SOURCE :
 *   `server/middleware/auth.ts`, les `const X = authorize([...])` (ou `authorize(CONSTANTE)`) du
 *   fichier lui-même et de `server/api/index.ts`, les `authorize([...])` en ligne, les tableaux de
 *   gardes (`...exportsGuard`). Les rôles viennent de `shared/constants/roles.ts` ; un rôle ou un
 *   spread non résolu rend la garde permissive.
 * - « neutral » : ne protège rien et n'ouvre rien (`requireFeature(...)`, liste blanche explicite).
 * - « permissive » : tout le reste, y compris tout identifiant inconnu (`requireSession`,
 *   `guardByX`, `gardeX`, une garde passée par une variable). Aucun nom n'est cru sur parole.
 * Une route dont un argument au moins est restrictif est saine ; sans argument de session elle est
 * publique (hors de ce contrôle) ; sinon elle doit contrôler le propriétaire ou l'OT avant l'envoi.
 *
 * Les gardes posées au montage (`apiRouter.use("/p", garde, routeur)`, spreads et `authorize` compris)
 * couvrent les routes du routeur ET toute route servie plus tard sur le même préfixe, `routes.ts`
 * compris (le routeur de `server/api/` est monté avant `registerRoutes`). Une garde montée APRÈS le
 * routeur qui sert la route ne la couvre pas.
 *
 * Une déclaration que le scan ne sait pas lire (`.get(` sans chemin littéral, chemin en tableau ou
 * en gabarit, `router.route()`) est rapportée à part (`unanalysable`) et doit être vide ou gelée.
 *
 * Limites connues, à ne pas prendre pour une preuve : le contrôle « avant l'envoi » est une
 * position textuelle, pas un flux. Un contrôle de VALEUR (un `ownerScopeOf` calculé puis non utilisé,
 * un filtre qui ne filtre pas) échappe à toute analyse statique ; un envoi par une aide
 * (`sendJson(res, ...)`) n'est pas vu ; une garde posée par `router.use("/chemin", garde)` ou par un
 * `app.all` n'est pas lue. Les contrats HTTP (`tests/contract/client-read-scope*.contract.test.ts`)
 * font foi pour le comportement ; ce scan ne garantit que la présence d'une garde ou d'un contrôle.
 */

/** Retire les commentaires de ligne et de bloc hors chaînes : un commentaire ne vaut ni garde ni contrôle. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export type Kind = "restrictive" | "permissive" | "neutral";
export type RoleConstants = Record<string, readonly string[] | undefined>;

export type GuardKinds = {
  restrictive: Set<string>;
  permissive: Set<string>;
  neutral: Set<string>;
  /** `const NOM = [a, b(), c]` : éléments, pour résoudre `...NOM`. */
  arrays: Map<string, string[]>;
  roles: RoleConstants;
};

/** Jetons posés par `parseMounts` : la garde de montage est déjà classée dans le contexte de `index.ts`. */
const TOKEN: Record<Kind, string> = { restrictive: "__restrictive__", permissive: "__permissive__", neutral: "__neutral__" };

/**
 * Appels qui ne protègent rien et n'ouvrent rien : liste blanche explicite.
 * `requireFeature` coupe en 404 derrière un drapeau, il ne lit pas la session.
 */
const NEUTRAL_CALLEES = new Set(["requireFeature"]);

/**
 * Gardes écrites à la main (corps non classable d'après des rôles) dont l'effet restrictif est prouvé
 * par un contrat. Liste blanche explicite, par fichier : un homonyme ailleurs n'est pas cru.
 * - `matrixCheck` (middleware/exports-guard.ts) refuse tout rôle absent de EXPORT_ROLE_MATRIX, donc le
 *   client, partout (tests/contract/client-read-scope-tires.contract.test.ts, cas exports).
 * - `guardByDoc` (api/work-order-export.routes.ts) répartit entre isStockIssuer et isTechnician, deux
 *   gardes sans client (tests/contract/work-order-export.contract.test.ts : client 403).
 */
export const RESTRICTIVE_ALLOWLIST: Record<string, string[]> = {
  "server/middleware/exports-guard.ts": ["matrixCheck"],
  "server/api/work-order-export.routes.ts": ["guardByDoc"],
};

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Index de la parenthèse fermante qui répond à l'ouvrante `open` (chaînes ignorées), -1 si absente. */
export function matchingClose(source: string, open: number): number {
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (OPENERS[c]) stack.push(OPENERS[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Découpe aux virgules de premier niveau (parenthèses, crochets, accolades et chaînes respectés). */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Vrai si `authorize(<expr>)` exclut le client : tableau ou constante entièrement résolus, sans `client`. */
function rolesExcludeClient(expr: string, roles: RoleConstants): boolean {
  const text = expr.trim();
  const items: string[] = text.startsWith("[") && text.endsWith("]") ? splitTopLevel(text.slice(1, -1)) : [`...${text}`];
  const resolved = new Set<string>();
  for (const item of items) {
    const literal = item.match(/^["'](\w+)["']$/);
    const spread = item.match(/^\.\.\.\s*(\w+)$/);
    if (literal) resolved.add(literal[1]);
    else if (spread && roles[spread[1]]) for (const r of roles[spread[1]]!) resolved.add(r);
    else return false; // non résolu : permissif
  }
  return resolved.size > 0 && !resolved.has("client");
}

function emptyKinds(roles: RoleConstants): GuardKinds {
  return { restrictive: new Set(), permissive: new Set(), neutral: new Set(), arrays: new Map(), roles };
}

/** Ajoute à `base` (copie) les `const NOM = ...` gardes, constantes neutres et tableaux de gardes de `rawSource`. */
export function extendKinds(base: GuardKinds, rawSource: string): GuardKinds {
  const kinds: GuardKinds = {
    restrictive: new Set(base.restrictive),
    permissive: new Set(base.permissive),
    neutral: new Set(base.neutral),
    arrays: new Map(base.arrays),
    roles: base.roles,
  };
  const src = stripComments(rawSource);
  const setKind = (name: string, kind: "restrictive" | "permissive" | "neutral") => {
    kinds.restrictive.delete(name);
    kinds.permissive.delete(name);
    kinds.neutral.delete(name);
    kinds[kind].add(name);
  };
  // Nom de garde connue redéclaré localement sans être reclassé : il ne vaut plus garde (échec fermé).
  const shadow = (name: string) => {
    if (kinds.restrictive.has(name) || kinds.neutral.has(name)) setKind(name, "permissive");
  };
  // `import { a as b }` : b vaut ce que vaut a, jamais ce que son nom laisse croire.
  for (const m of src.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const spec of m[1].split(",")) {
      const alias = spec.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (!alias || alias[1] === alias[2]) continue;
      const [, original, local] = alias;
      setKind(local, kinds.restrictive.has(original) ? "restrictive" : kinds.neutral.has(original) ? "neutral" : "permissive");
    }
  }
  for (const m of src.matchAll(/\bfunction\s+(\w+)\s*\(/g)) shadow(m[1]);
  for (const m of src.matchAll(/(?:^|[\s;])(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*/g)) {
    const name = m[1];
    const at = m.index! + m[0].length;
    const call = src.slice(at).match(/^([\w.]+)\s*\(/);
    if (call) {
      const open = at + call[0].length - 1;
      const close = matchingClose(src, open);
      if (close === -1) {
        shadow(name);
        continue;
      }
      const inner = src.slice(open + 1, close);
      if (call[1] === "authorize") setKind(name, rolesExcludeClient(inner, kinds.roles) ? "restrictive" : "permissive");
      else if (NEUTRAL_CALLEES.has(call[1])) setKind(name, "neutral");
      else if (call[1] === "sessionGuard") {
        const kind = classifyDispatcher(inner, kinds);
        if (kind) setKind(name, kind);
        else shadow(name);
      } else shadow(name);
    } else if (src[at] === "[") {
      const close = matchingClose(src, at);
      if (close !== -1) kinds.arrays.set(name, splitTopLevel(src.slice(at + 1, close)));
    } else shadow(name);
  }
  return kinds;
}

/** Garde de session dont le corps répartit entre gardes connues : restrictive si toutes celles qu'il cite le sont. */
function classifyDispatcher(inner: string, kinds: GuardKinds): "restrictive" | "permissive" | null {
  const cited = [...new Set(inner.match(/\b\w+\b/g) ?? [])].filter((w) => kinds.restrictive.has(w) || kinds.permissive.has(w));
  if (cited.length === 0) return null;
  // `next()` appelé en direct : une branche laisse passer sans aucune des gardes citées.
  if (/\bnext\s*\(\s*\)/.test(inner)) return "permissive";
  return cited.every((w) => kinds.restrictive.has(w)) ? "restrictive" : "permissive";
}

/**
 * Classe un argument d'en-tête de route ou de montage. Tout ce qui n'est pas reconnu est permissif.
 */
export function classifyArg(rawArg: string, kinds: GuardKinds, seen: Set<string> = new Set()): Kind {
  const arg = rawArg.trim();
  for (const kind of Object.keys(TOKEN) as Kind[]) if (arg === TOKEN[kind]) return kind;

  const authorizeCall = arg.match(/^authorize\s*\(([\s\S]*)\)$/);
  if (authorizeCall) return rolesExcludeClient(authorizeCall[1], kinds.roles) ? "restrictive" : "permissive";

  const sessionCall = arg.match(/^sessionGuard\s*\(([\s\S]*)\)$/);
  if (sessionCall) return classifyDispatcher(sessionCall[1], kinds) ?? "permissive";

  const spread = arg.match(/^\.\.\.\s*(\w+)$/);
  const list = arg.startsWith("[") && arg.endsWith("]") ? splitTopLevel(arg.slice(1, -1)) : spread ? kinds.arrays.get(spread[1]) : undefined;
  if (spread || list) {
    if (!list || (spread && seen.has(spread[1]))) return "permissive";
    if (spread) seen = new Set(seen).add(spread[1]);
    const members = list.map((item) => classifyArg(item, kinds, seen));
    if (members.includes("restrictive")) return "restrictive";
    return members.every((k) => k === "neutral") ? "neutral" : "permissive";
  }

  const name = arg.match(/^(\w+)$/);
  if (name) {
    if (kinds.restrictive.has(name[1])) return "restrictive";
    if (kinds.neutral.has(name[1])) return "neutral";
    return "permissive"; // garde connue permissive, ou identifiant inconnu : même verdict
  }

  const callee = arg.match(/^([\w.]+)\s*\(/);
  if (callee && NEUTRAL_CALLEES.has(callee[1])) return "neutral";
  return "permissive";
}

/** Un ensemble de gardes : exclut-il le client ? y a-t-il une garde de session (ou présumée telle) ? */
export function classifyChain(args: string[], kinds: GuardKinds): { restrictive: boolean; session: boolean } {
  const kindsOf = args.map((a) => classifyArg(a, kinds));
  return { restrictive: kindsOf.includes("restrictive"), session: kindsOf.some((k) => k !== "neutral") };
}

export type GuardKindSets = GuardKinds;

/**
 * Classe les gardes exportées par `server/middleware/auth.ts` : « restrictive » = exclut le client,
 * « permissive » = le laisse passer. Dérivé du code, pas d'une liste écrite à la main : un rôle
 * `client` ajouté à une garde la fait basculer. Un tableau de rôles non résolu est permissif
 * (échec fermé).
 */
export function classifyAuthGuards(authSource: string, roleConstants: RoleConstants): GuardKinds {
  const base = emptyKinds(roleConstants);
  base.restrictive.add("isAdmin");
  base.permissive.add("authenticate");
  const kinds = extendKinds(base, authSource);
  // `isAdmin = sessionGuard(...)` contrôle le rôle sans citer de garde : sa lecture dans auth.ts le déclasse.
  kinds.permissive.delete("isAdmin");
  kinds.restrictive.add("isAdmin");
  return kinds;
}

/** Contrôles de cloison reconnus (propriétaire, OT lisible). */
const SCOPE_MARKERS = [/\bassertWorkOrderReadable\b/, /\bassertVehicleSubresourcesReadable\b/, /\bcanAccessOwned\b/, /\bownerScopeOf\b/, /\brole\s*[!=]==?\s*["']client["']/];
const WORK_ORDER_MARKER = /\bassertWorkOrderReadable\b/;
/** Gardes qui lèvent une erreur : en instruction seule, elles protègent. */
const THROWING_MARKERS = new Set(["assertWorkOrderReadable", "assertVehicleSubresourcesReadable"]);
const HANDLER_START = /\basync\b|\bfunction\b|\(\s*_?req\b|\(\s*_?request\b|=>/;

/**
 * Position du premier envoi de donnée dans `body`, -1 si aucun. Est un envoi : `res.json/send/end/
 * sendFile/download/write(...)`, `x.pipe(res)`, et `res.status(<autre chose qu'un 4xx/5xx littéral>)`
 * (`res.status(code).json(...)` : le code est inconnu, la réponse peut porter la donnée).
 */
export function firstDataSend(body: string): number {
  for (const m of body.matchAll(/\bres\s*\.\s*(status|json|send|end|sendFile|download|write)\s*\(/g)) {
    if (m[1] !== "status") return m.index!;
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(body, open);
    const code = close === -1 ? "" : body.slice(open + 1, close).trim();
    if (!/^[45]\d\d$/.test(code)) return m.index!;
    // une réponse d'erreur qui porte autre chose qu'un message littéral peut porter la donnée
    const chained = body.slice(close + 1).match(/^\s*\.\s*(json|send)\s*\(/);
    if (chained) {
      const payloadOpen = close + 1 + chained[0].length - 1;
      const payloadClose = matchingClose(body, payloadOpen);
      const payload = payloadClose === -1 ? "?" : body.slice(payloadOpen + 1, payloadClose).trim();
      if (!isMessagePayload(payload)) return m.index!;
    }
  }
  const pipe = body.search(/\.\s*pipe\(\s*res\b/);
  return pipe;
}

/** Corps d'erreur sans donnée : vide, chaîne littérale, ou objet littéral sans `await`, appel ni spread. */
function isMessagePayload(payload: string): boolean {
  if (payload === "" || /^(["'])[^"']*\1$/.test(payload)) return true;
  return payload.startsWith("{") && payload.endsWith("}") && !/\bawait\b|\.\.\.|\w\s*\(/.test(blankStrings(payload));
}

/** Vide le contenu des chaînes (positions conservées) : un mot dans un message n'est pas du code. */
export function blankStrings(source: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
        continue;
      }
      if (c === quote) {
        quote = null;
        out += c;
      } else out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
  }
  return out;
}

export type GetRoute = {
  file: string;
  path: string;
  key: string;
  header: string;
  body: string;
  /** Arguments de l'en-tête (gardes), poignée finale retirée quand elle n'est pas écrite en ligne. */
  headerArgs: string[];
  mountPrefix: string;
  routerVar: string;
  /** Position de la déclaration dans le source sans commentaires (pour les `use` posés avant). */
  at: number;
};

function routerVarsOf(source: string): Set<string> {
  const vars = new Set<string>(["app", "apiRouter", "router"]);
  for (const m of source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:express\s*\.\s*)?Router\s*\(/g)) vars.add(m[1]);
  return vars;
}

/** Routes GET d'un fichier (commentaires retirés). `mounts` : variable de routeur -> préfixe de montage. */
export function extractGetRoutes(file: string, rawSource: string, mounts: Map<string, string> = new Map()): GetRoute[] {
  const source = stripComments(rawSource);
  const out: GetRoute[] = [];
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*get\(\s*(["'`])([^"'`]*)\2/g)) {
    if (m[2] === "`" && m[3].includes("${")) continue; // rapporté par findUnanalysable
    const open = source.indexOf("(", m.index! + m[1].length);
    const close = matchingClose(source, open);
    // appel illisible : en-tête présumé permissif et corps vide, donc refusé (échec fermé)
    const args = close === -1 ? [m[3], "__unreadable__", "__handler__"] : splitTopLevel(source.slice(open + 1, close));
    const last = args[args.length - 1] ?? "";
    // le dernier argument est la poignée : son texte est le corps s'il est écrit en ligne, sinon une référence nommée
    const body = args.length > 1 && HANDLER_START.test(last.slice(0, 80)) ? last : "";
    const headerArgs = args.slice(1, -1);
    const header = headerArgs.join(", ");
    const mountPrefix = mounts.get(m[1]) ?? "";
    out.push({
      file,
      path: m[3],
      key: `${file} GET ${mountPrefix}${m[3]}`,
      header,
      body,
      headerArgs,
      mountPrefix,
      routerVar: m[1],
      at: m.index!,
    });
  }
  return out;
}

/**
 * Déclarations de lecture que le scan ne sait pas lire : `.get(` d'un routeur sans chemin littéral
 * (variable, tableau, gabarit à `${}`) et `router.route(...)`. À rapporter, jamais à ignorer.
 */
export function findUnanalysable(file: string, rawSource: string): string[] {
  const source = stripComments(rawSource);
  const routers = routerVarsOf(source);
  const out: string[] = [];
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*(get|route)\s*\(/g)) {
    if (!routers.has(m[1])) continue;
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(source, open);
    const first = close === -1 ? "" : (splitTopLevel(source.slice(open + 1, close))[0] ?? "");
    const literal = /^(["'`])[^"'`]*\1$/.test(first);
    const isTemplateWithExpr = first.startsWith("`") && first.includes("${");
    if (m[2] === "get" && literal && !isTemplateWithExpr) continue;
    out.push(`${file} ${m[1]}.${m[2]}(${first.replace(/\s+/g, " ").slice(0, 60)}`);
  }
  return out;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function isWorkOrderRead(route: Pick<GetRoute, "path" | "mountPrefix">): boolean {
  return /work-orders\/:|:workOrderId/.test(route.path) || (route.mountPrefix.includes("work-orders") && /:/.test(route.path));
}

/** Le contrôle de cloison apparaît-il avant le premier envoi de donnée ? */
export function scopeCheckedBeforeSend(body: string, markers: RegExp[]): boolean {
  const code = blankStrings(body);
  const sendAt = firstDataSend(code);
  return markers.some((marker) => {
    const global = new RegExp(marker.source, marker.flags.includes("g") ? marker.flags : `${marker.flags}g`);
    // cherché dans le source (le marqueur `role === "client"` contient une chaîne), retenu seulement s'il commence hors chaîne
    return [...body.matchAll(global)].some(
      (m) => code[m.index!] === body[m.index!] && (sendAt === -1 || m.index! < sendAt) && markerUsed(code, m.index!, m[0]),
    );
  });
}

/**
 * Un contrôle dont le résultat est jeté ne protège rien : `const s = ownerScopeOf(...)` sans usage
 * de `s`, ou `canAccessOwned(...)` / `ownerScopeOf(...)` en instruction seule.
 * `assertWorkOrderReadable(...)` et `assertVehicleSubresourcesReadable(...)` lèvent une erreur :
 * en instruction seule, ils protègent, à condition d'être attendus (`await` ou `return`).
 */
function markerUsed(code: string, at: number, word: string): boolean {
  const before = code.slice(0, at);
  // une garde async qui lève ne protège que si sa promesse est attendue (sinon le rejet arrive après l'envoi)
  if (THROWING_MARKERS.has(word)) return /\b(?:await|return)\s+$/.test(before);
  if (!/^\w+$/.test(word)) return true;
  const assigned = before.match(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:await\s+)?$/);
  if (assigned) return new RegExp(String.raw`\b${assigned[1]}\b`).test(code.slice(at + word.length));
  return !/(?:^|[;{}])\s*(?:await\s+)?$/.test(before);
}

/**
 * Verdict sur une lecture. `fileGuards` : gardes posées sur tout le routeur (`router.use(garde)`)
 * ou à son montage (expressions ou jetons de `parseMounts`).
 */
export function judgeGetRoute(route: GetRoute, kinds: GuardKinds, fileGuards: string[] = []): Verdict {
  const { restrictive, session } = classifyChain([...fileGuards, ...route.headerArgs], kinds);
  if (restrictive) return { ok: true };
  if (!session) return { ok: true }; // aucune garde de session : route publique, hors de ce contrôle
  const markers = isWorkOrderRead(route) ? [WORK_ORDER_MARKER] : SCOPE_MARKERS;
  if (scopeCheckedBeforeSend(route.body, markers)) return { ok: true };
  return { ok: false, reason: "session seule : aucun contrôle de cloison avant l'envoi de la donnée" };
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "_archive" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Vrai si l'instruction à `index` ne s'exécute pas toujours : corps d'un `if` / `else` / `for` / `while`
 * (avec ou sans accolades) ou branche d'un `?:`/`&&`. Un `router.use(isStaff)` conditionnel ne protège pas la route.
 */
export function isConditionalAt(source: string, index: number): boolean {
  const head = source.slice(0, index);
  if (/(?:\bif\s*\((?:[^()]|\([^()]*\))*\)|\belse|\b(?:for|while)\s*\((?:[^()]|\([^()]*\))*\))\s*$/.test(head)) return true;
  if (/(?:&&|\|\||\?)\s*$/.test(head)) return true;
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = source[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (/(?:\bif\s*\((?:[^()]|\([^()]*\))*\)|\belse(?:\s+if\s*\((?:[^()]|\([^()]*\))*\))?|\b(?:for|while)\s*\((?:[^()]|\([^()]*\))*\))\s*$/.test(source.slice(0, i))) return true;
    }
  }
  return false;
}

/**
 * Gardes posées sur tout un routeur par `router.use(garde)` (sans chemin) : identifiants nus,
 * `authorize(...)`, `sessionGuard(...)` et spreads. Les autres appels (`express.json()`) sont du bruit.
 */
export function routerLevelGuards(rawSource: string, kinds: GuardKinds, before: number = Number.POSITIVE_INFINITY): Map<string, string[]> {
  const source = stripComments(rawSource);
  // échec fermé, comme en en-tête : un identifiant nu inconnu compte comme garde permissive (route retenue).
  // Seuls les sous-routeurs (`use(unRouteur)`) sont du bruit.
  const routers = routerVarsOf(source);
  const knownKind = (a: string) => kinds.restrictive.has(a) || kinds.permissive.has(a) || kinds.neutral.has(a);
  // intergiciels globaux (`app.use(cors)`, `apiRouter.use(session)`) : bruit, seules les gardes connues comptent
  const known = (a: string, receiver: string) => !/^\w+$/.test(a) || knownKind(a) || (!["app", "apiRouter"].includes(receiver) && !(routers.has(a) || /Router$/.test(a)));
  const isGuardArg = (a: string) => /^(\w+|authorize\s*\(.*\)|sessionGuard\s*\(.*\)|\.\.\.\s*\w+)$/s.test(a);
  const out = new Map<string, string[]>();
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*use\(/g)) {
    // Express applique les `use` dans l'ordre : un `use` posé après la route ne la couvre pas.
    if (m.index! >= before) break;
    // un `use` conditionnel (if/else/boucle/&&) ne couvre pas toujours la route : il ne compte pas
    if (isConditionalAt(source, m.index!)) continue;
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(source, open);
    if (close === -1) continue;
    const args = splitTopLevel(source.slice(open + 1, close));
    if (args.length === 0 || /^["'`]/.test(args[0])) continue;
    const guards = args.filter((a) => isGuardArg(a) && known(a, m[1]));
    if (guards.length > 0) out.set(m[1], [...(out.get(m[1]) ?? []), ...guards]);
  }
  return out;
}

export type Mount = { variable: string; prefix: string; guards: string[]; file: string | null; order: number };

/**
 * Montages de `server/api/index.ts` : variable importée -> { préfixe, gardes au montage (déjà classées,
 * en jetons), fichier, rang }. `kinds` doit connaître les gardes locales de `index.ts` et des middlewares
 * qu'il importe (voir `scanOpenGetReads`).
 */
export function parseMounts(indexSource: string, kinds: GuardKinds): Mount[] {
  const source = stripComments(indexSource);
  const importedFrom = new Map<string, string>();
  for (const m of source.matchAll(/import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["']\.\/([\w.-]+)["']/g)) {
    const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean);
    for (const name of names) importedFrom.set(name, m[3]);
  }
  const mounts: Mount[] = [];
  for (const m of source.matchAll(/\bapiRouter\s*\.\s*use\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(source, open);
    if (close === -1) continue;
    const args = splitTopLevel(source.slice(open + 1, close));
    const prefixLiteral = args[0]?.match(/^["']([^"']+)["']$/);
    const rest = prefixLiteral ? args.slice(1) : args;
    const variable = rest[rest.length - 1];
    if (!variable || !/^\w+$/.test(variable)) continue;
    const guards = rest.slice(0, -1).map((g) => TOKEN[classifyArg(g, kinds)]);
    mounts.push({ variable, prefix: prefixLiteral?.[1] ?? "", guards, file: importedFrom.get(variable) ?? null, order: mounts.length });
  }
  return mounts;
}

const fullPathOf = (file: string, prefix: string, path: string) => (file === "server/routes.ts" ? path : `/api${prefix}${path}`);
const underPrefix = (fullPath: string, prefix: string) => fullPath === `/api${prefix}` || fullPath.startsWith(`/api${prefix}/`);

/**
 * Montage d'une variable de routeur : par son nom, sinon le seul montage connu du fichier, mais seulement si cette
 * variable est le routeur exporté (ou le seul routeur du fichier). Un second routeur non monté n'hérite pas des gardes.
 */
export function mountOf<T extends { variable: string }>(fileMounts: T[], routerVar: string, rawSource: string): T | undefined {
  const byName = fileMounts.find((m) => m.variable === routerVar);
  if (byName || fileMounts.length !== 1) return byName;
  const source = stripComments(rawSource);
  const declared = [...source.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:express\s*\.\s*)?Router\s*\(/g)].map((m) => m[1]);
  const exported = source.match(/export\s+default\s+(\w+)/)?.[1];
  return declared.length <= 1 || exported === routerVar ? fileMounts[0] : undefined;
}

/** Gardes de base (auth.ts) et montages de `server/api/index.ts`, communs aux scans de routes. */
function guardContext(serverDir: string, roleConstants: RoleConstants) {
  const baseKinds = classifyAuthGuards(readFileSync(join(serverDir, "middleware", "auth.ts"), "utf8"), roleConstants);
  // gardes locales de index.ts et des middlewares qu'il importe (ex. `exportsGuard`)
  let indexKinds = extendKinds(baseKinds, "");
  for (const path of sourceFiles(join(serverDir, "middleware"))) indexKinds = extendKinds(indexKinds, readFileSync(path, "utf8"));
  // classements faits à la main, reposés après la lecture des fichiers où ces gardes sont définies
  for (const name of [...RESTRICTIVE_ALLOWLIST["server/middleware/exports-guard.ts"], ...baseKinds.restrictive]) {
    indexKinds.permissive.delete(name);
    indexKinds.restrictive.add(name);
  }
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  indexKinds = extendKinds(indexKinds, indexSource);
  const mounts = parseMounts(indexSource, indexKinds);
  return { baseKinds, mounts };
}

/**
 * Parcourt `server/` et renvoie les lectures GET ouvertes à un client sans cloison (clé `fichier GET chemin`),
 * les déclarations illisibles et les routes vues.
 */
export function scanOpenGetReads(serverDir: string, roleConstants: RoleConstants) {
  const { baseKinds, mounts } = guardContext(serverDir, roleConstants);

  const offenders: string[] = [];
  const unanalysable: string[] = [];
  const seen = new Set<string>();
  for (const path of sourceFiles(serverDir)) {
    const file = `server/${path.slice(serverDir.length + 1).replace(/\\/g, "/")}`;
    const raw = readFileSync(path, "utf8");
    unanalysable.push(...findUnanalysable(file, raw));
    const kinds = extendKinds(baseKinds, raw);
    for (const name of RESTRICTIVE_ALLOWLIST[file] ?? []) kinds.restrictive.add(name);
    const fileMounts = mounts.filter((m) => m.file && file === `server/api/${m.file}.ts`);
    for (const route of extractGetRoutes(file, raw)) {
      const routerGuards = routerLevelGuards(raw, kinds, route.at);
      // un fichier peut exporter plusieurs routeurs : on rattache par variable, sinon au seul montage connu
      const own = mountOf(fileMounts, route.routerVar, raw);
      const prefix = own?.prefix ?? "";
      const full = { ...route, mountPrefix: prefix, key: `${file} GET ${prefix}${route.path}` };
      seen.add(full.key);
      // montages gardés posés AVANT le routeur qui sert la route (routes.ts : tous) sur un préfixe qui la couvre
      const fullPath = fullPathOf(file, prefix, route.path);
      const servedAt = file === "server/routes.ts" ? Number.POSITIVE_INFINITY : (own?.order ?? Number.POSITIVE_INFINITY);
      const masking = mounts.filter((m) => m.prefix && m.order <= servedAt && underPrefix(fullPath, m.prefix) && m !== own).flatMap((m) => m.guards);
      const verdict = judgeGetRoute(full, kinds, [...masking, ...(own?.guards ?? []), ...(routerGuards.get(route.routerVar) ?? [])]);
      if (!verdict.ok) offenders.push(full.key);
    }
  }
  return { offenders: offenders.sort(), unanalysable: unanalysable.sort(), seen };
}

/** Méthode + chemin complet, paramètres anonymisés : `/api/x/:id` et `/api/x/:vehicleId` sont la même route. */
export const routeSignature = (method: string, fullPath: string) =>
  `${method.toUpperCase()} ${fullPath.replace(/:\w+/g, ":p").replace(/\/+$/, "") || "/"}`;

/** Déclarations `routeur.méthode("chemin"` d'un fichier (commentaires retirés), toutes méthodes. */
export function extractRoutes(rawSource: string): Array<{ routerVar: string; method: string; path: string }> {
  const source = stripComments(rawSource);
  const routers = routerVarsOf(source);
  const out: Array<{ routerVar: string; method: string; path: string }> = [];
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*(get|post|put|patch|delete)\(\s*(["'`])([^"'`]*)\3/g)) {
    if (!routers.has(m[1]) || (m[3] === "`" && m[4].includes("${"))) continue;
    out.push({ routerVar: m[1], method: m[2], path: m[4] });
  }
  return out;
}

/**
 * Écritures (POST, PUT, PATCH, DELETE) de `server/routes.ts` (routeur `app`) et des routeurs montés dans
 * `server/api/index.ts`, avec le texte de leur déclaration (gardes et poignée, commentaires retirés).
 * Signatures `METHODE /api/chemin/:p` (cf. `routeSignature`). Une poignée nommée (`validateVoucher`)
 * déclarée dans le même fichier est ajoutée au texte. Même limite que `scanShadowedRoutes` :
 * un sous-routeur monté par un autre fichier n'est pas vu.
 */
function namedHandlerText(source: string, name: string): string {
  const decl = new RegExp(String.raw`(?:\bfunction\s+${name}\s*\(|\b(?:const|let)\s+${name}\b[^=]*=)`).exec(source);
  if (!decl) return "";
  const brace = source.indexOf("{", decl.index + decl[0].length);
  const close = brace < 0 ? -1 : matchingClose(source, brace);
  return close < 0 ? "" : source.slice(decl.index, close + 1);
}

export function scanWriteRoutes(serverDir: string): Array<{ signature: string; file: string; handler: string }> {
  return walkWriteRoutes(serverDir).reached;
}

/**
 * Écritures de `server/api/` que `scanWriteRoutes` ne voit pas : fichier non monté par `index.ts`, ou
 * routeur du fichier sans montage. Elles échappent à tout garde-fou qui s'appuie sur ce balayage.
 */
export function scanUnreachedWriteRoutes(serverDir: string): string[] {
  return walkWriteRoutes(serverDir).unreached;
}

// Montage d'un routeur : `x.use("/p", ..., fooRoutes)` ou `x.use(fooRouter)`. Une fonction en ligne n'en est pas un.
export const ROUTER_MOUNT = /\.\s*use\(\s*(?:["'`][^"'`]*["'`]\s*,\s*)?(?:[^()]*,\s*)?\w*(?:Router|Routes|routes|router)\s*\)/;

/**
 * Fichiers serveur qui montent un routeur hors de `server/api/index.ts` et `server/app.ts` : leurs
 * routes recevraient un préfixe en cascade que `parseMounts` ne lit pas.
 */
export function scanNestedRouterMounts(serverDir: string): string[] {
  const allowed = new Set(["api/index.ts", "app.ts"]);
  return sourceFiles(serverDir)
    .map((path) => path.slice(serverDir.length + 1).replace(/\\/g, "/"))
    .filter((file) => !allowed.has(file))
    .filter((file) => ROUTER_MOUNT.test(stripComments(readFileSync(join(serverDir, file), "utf8"))))
    .map((file) => `server/${file}`);
}

function walkWriteRoutes(serverDir: string): { reached: Array<{ signature: string; file: string; handler: string }>; unreached: string[] } {
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  const mounts = parseMounts(indexSource, { restrictive: new Set(), permissive: new Set(), neutral: new Set(), arrays: new Map(), roles: {} });
  const out: Array<{ signature: string; file: string; handler: string }> = [];
  const unreached: string[] = [];
  const collect = (file: string, raw: string, prefixOf: (routerVar: string) => string | undefined) => {
    const source = stripComments(raw);
    const routers = routerVarsOf(source);
    for (const m of source.matchAll(/\b(\w+)\s*\.\s*(post|put|patch|delete)\(\s*(["'`])([^"'`]*)\3/g)) {
      if (!routers.has(m[1]) || (m[3] === "`" && m[4].includes("${"))) continue;
      const prefix = prefixOf(m[1]);
      if (prefix === undefined) {
        unreached.push(`${file}: ${m[2].toUpperCase()} ${m[4]}`);
        continue;
      }
      const open = source.indexOf("(", m.index! + m[1].length);
      const close = matchingClose(source, open);
      const declaration = source.slice(open, close < 0 ? undefined : close);
      const named = splitTopLevel(declaration.slice(1))
        .map((arg) => arg.trim())
        .filter((arg) => /^\w+$/.test(arg))
        .map((name) => namedHandlerText(source, name));
      out.push({ signature: routeSignature(m[2], `${prefix}${m[4]}`), file, handler: [declaration, ...named].join(" ") });
    }
  };
  collect("server/routes.ts", readFileSync(join(serverDir, "routes.ts"), "utf8"), (v) => (v === "app" ? "" : undefined));
  for (const path of sourceFiles(join(serverDir, "api"))) {
    const file = `server/api/${path.slice(join(serverDir, "api").length + 1).replace(/\\/g, "/")}`;
    if (file === "server/api/index.ts") {
      collect(file, readFileSync(path, "utf8"), (v) => (v === "apiRouter" ? "/api" : undefined));
      continue;
    }
    const fileMounts = mounts.filter((m) => m.file && file === `server/api/${m.file}.ts`);
    const raw = readFileSync(path, "utf8");
    collect(file, raw, (v) => {
      const own = fileMounts.length === 0 ? undefined : mountOf(fileMounts, v, raw);
      return own ? `/api${own.prefix}` : undefined;
    });
    // Bouchons `createStubRouter([...])` : routes déclarées en données, servies dès le montage (501).
    const source = stripComments(raw);
    if (!/\bcreateStubRouter\s*\(/.test(source)) continue;
    for (const m of source.matchAll(/\{[^{}]*\bmethod\s*:\s*["'](post|put|patch|delete)["'][^{}]*\bpath\s*:\s*["']([^"']*)["'][^{}]*\}/g)) {
      if (fileMounts.length !== 1) {
        unreached.push(`${file}: ${m[1].toUpperCase()} ${m[2]} (bouchon)`);
        continue;
      }
      out.push({ signature: routeSignature(m[1], `/api${fileMounts[0].prefix}${m[2]}`), file, handler: m[0] });
    }
  }
  return { reached: out, unreached };
}

/**
 * Routes de `server/routes.ts` masquées par un routeur de `server/api/` : `apiRouter` est monté sur
 * `/api` AVANT `registerRoutes` (server/app.ts), donc Express sert la déclaration de `server/api/`
 * et celle de `routes.ts` dort, avec ses gardes et sa logique, prête à revenir si l'autre disparaît.
 * Renvoie les signatures en double et le nombre de routes de `server/api/` rattachées à un montage.
 * Limite : seuls les routeurs montés dans `server/api/index.ts` sont vus (pas un sous-routeur monté
 * par un autre fichier), et deux chemins différents qui se recouvrent (`/:id` contre `/top`) ne sont
 * pas comparés.
 */
export function scanShadowedRoutes(serverDir: string) {
  const indexSource = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
  const mounts = parseMounts(indexSource, { restrictive: new Set(), permissive: new Set(), neutral: new Set(), arrays: new Map(), roles: {} });
  const apiSignatures = new Set<string>();
  for (const path of sourceFiles(join(serverDir, "api"))) {
    const file = `server/api/${path.slice(join(serverDir, "api").length + 1).replace(/\\/g, "/")}`;
    const fileMounts = mounts.filter((m) => m.file && file === `server/api/${m.file}.ts`);
    if (fileMounts.length === 0) continue;
    const raw = readFileSync(path, "utf8");
    for (const route of extractRoutes(raw)) {
      const own = mountOf(fileMounts, route.routerVar, raw);
      if (!own) continue;
      apiSignatures.add(routeSignature(route.method, `/api${own.prefix}${route.path}`));
    }
  }
  const legacy = extractRoutes(readFileSync(join(serverDir, "routes.ts"), "utf8"))
    .filter((route) => route.routerVar === "app")
    .map((route) => routeSignature(route.method, route.path));
  const shadowed = [...new Set(legacy.filter((signature) => apiSignatures.has(signature)))].sort();
  return { shadowed, apiRouteCount: apiSignatures.size, legacyRouteCount: legacy.length };
}

/**
 * Routes (toutes methodes) dont le chemin porte un parametre et dont l'en-tete contient la garde
 * `isAnyUser` : un client peut y viser un objet. Chaque route doit figurer au balayage de cloison
 * (`tests/support/client-scope-sweep-table.ts`) ou a sa liste d'exclusions justifiee. Renvoie des
 * signatures `METHODE /api/chemin/:p` (cf. `routeSignature`). Gardes effectives = montages, `router.use`
 * poses avant la route et en-tete ; toute route avec une garde de session sans garde restrictive est retenue.
 * Limite : un routeur importe par un autre fichier que `server/api/index.ts` n'est pas rattache a son prefixe.
 */
export function scanClientOpenParamRoutes(serverDir: string, roleConstants: RoleConstants): string[] {
  const { baseKinds, mounts } = guardContext(serverDir, roleConstants);
  const found = new Set<string>();
  for (const path of sourceFiles(serverDir)) {
    const file = `server/${path.slice(serverDir.length + 1).replace(/\\/g, "/")}`;
    const raw = readFileSync(path, "utf8");
    const source = stripComments(raw);
    const kinds = extendKinds(baseKinds, raw);
    for (const name of RESTRICTIVE_ALLOWLIST[file] ?? []) kinds.restrictive.add(name);
    const routers = routerVarsOf(source);
    const fileMounts = mounts.filter((m) => m.file && file === `server/api/${m.file}.ts`);
    for (const call of source.matchAll(/\b(\w+)\s*\.\s*(get|post|put|patch|delete)\(/g)) {
      if (!routers.has(call[1])) continue;
      const open = call.index! + call[0].length - 1;
      const close = matchingClose(source, open);
      if (close === -1) continue;
      const callArgs = splitTopLevel(source.slice(open + 1, close));
      const first = callArgs[0] ?? "";
      const literal = first.match(/^(["'`])([^"'`]*)\1$/);
      // échec fermé : un chemin en gabarit (`${}` -> `:p`) ou illisible (variable, appel) est retenu, jamais ignoré
      const routePath = literal && !(literal[1] === "`" && literal[2].includes("${")) ? literal[2] : literal ? literal[2].replace(/\$\{[^}]*\}/g, ":p") : `/:illisible(${first.replace(/\s+/g, " ").slice(0, 40)})`;
      if (!routePath.includes(":")) continue;
      // un handler seul (`map.get(key)`) n'est pas une route : il faut au moins un chemin et un handler
      if (callArgs.length < 2) continue;
      const m = [call[0], call[1], call[2], "", routePath] as unknown as RegExpMatchArray;
      m.index = call.index;
      const header = callArgs.slice(1, -1);
      const own = mountOf(fileMounts, m[1], raw);
      const fullPath = fullPathOf(file, own?.prefix ?? "", m[4]);
      // memes gardes effectives que scanOpenGetReads : montages masquants, montage propre, `router.use` poses avant, en-tete
      const servedAt = file === "server/routes.ts" ? Number.POSITIVE_INFINITY : (own?.order ?? Number.POSITIVE_INFINITY);
      const masking = mounts.filter((x) => x.prefix && x.order <= servedAt && underPrefix(fullPath, x.prefix) && x !== own).flatMap((x) => x.guards);
      const effective = [...masking, ...(own?.guards ?? []), ...(routerLevelGuards(raw, kinds, m.index!).get(m[1]) ?? []), ...header];
      // echec ferme : une garde de session sans garde restrictive laisse passer un client
      const chain = classifyChain(effective, kinds);
      if (!chain.session || chain.restrictive) continue;
      found.add(routeSignature(m[2], fullPath));
    }
  }
  return [...found].sort();
}
