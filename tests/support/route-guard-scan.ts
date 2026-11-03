import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Analyse statique des routes GET du serveur, pour le garde-fou de cloison client
 * (`tests/unit/server/routes-hygiene.test.ts`, AGENTS.md §11).
 *
 * Une lecture est « ouverte à un client sans cloison » quand elle porte une garde de session
 * (`authenticate`, `isAnyUser`, `authorize([... 'client' ...])`, `isWorkflowDocumentWriter`...)
 * mais aucune garde qui exclut le client, et que son corps ne contrôle ni le propriétaire ni
 * l'OT AVANT d'envoyer la donnée.
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

export type GuardKinds = { restrictive: Set<string>; permissive: Set<string> };

/**
 * Classe les gardes exportées par `server/middleware/auth.ts` : « restrictive » = exclut le client,
 * « permissive » = le laisse passer. Dérivé du code, pas d'une liste écrite à la main : un rôle
 * `client` ajouté à une garde la fait basculer. Un tableau de rôles non résolu est permissif
 * (échec fermé).
 */
export function classifyAuthGuards(authSource: string, roleConstants: Record<string, readonly string[] | undefined>): GuardKinds {
  const src = stripComments(authSource);
  const restrictive = new Set<string>(["isAdmin"]);
  const permissive = new Set<string>(["authenticate"]);
  for (const m of src.matchAll(/export const (\w+)\s*=\s*authorize\(\s*\[([^\]]*)\]\s*\)/g)) {
    const [, name, list] = m;
    const roles = new Set<string>();
    let resolved = true;
    for (const item of list.split(",").map((s) => s.trim()).filter(Boolean)) {
      const literal = item.match(/^["'](\w+)["']$/);
      const spread = item.match(/^\.\.\.(\w+)$/);
      if (literal) roles.add(literal[1]);
      else if (spread && roleConstants[spread[1]]) for (const r of roleConstants[spread[1]]!) roles.add(r);
      else resolved = false;
    }
    (resolved && !roles.has("client") ? restrictive : permissive).add(name);
  }
  return { restrictive, permissive };
}

/** Contrôles de cloison reconnus (propriétaire, OT lisible). */
const SCOPE_MARKERS = [/\bassertWorkOrderReadable\b/, /\bcanAccessOwned\b/, /\bownerScopeOf\b/, /\brole\s*[!=]==?\s*["']client["']/];
const WORK_ORDER_MARKER = /\bassertWorkOrderReadable\b/;
/** Premier envoi de donnée : `res.json(`, `res.status(2xx).json(`, `res.send(`... (une erreur 4xx/5xx n'en est pas un). */
const DATA_SEND = /\bres\s*\.\s*(?:status\(\s*[23]\d\d\s*\)\s*\.\s*)?(?:json|send|end|sendFile|download)\s*\(/;
const HANDLER_START = /\basync\b|\bfunction\b|\(\s*_?req\b|\(\s*_?request\b|=>/;
const NEXT_DECLARATION = /\n\s*\w+\s*\.\s*(?:get|post|patch|put|delete|use|all)\s*\(/;

export type GetRoute = {
  file: string;
  path: string;
  key: string;
  header: string;
  body: string;
  guards: string[];
  inlineAuthorizeRoles: string[][];
  mountPrefix: string;
  routerVar: string;
};

/** Routes GET d'un fichier (commentaires retirés). `mounts` : variable de routeur -> préfixe de montage. */
export function extractGetRoutes(file: string, rawSource: string, mounts: Map<string, string> = new Map()): GetRoute[] {
  const source = stripComments(rawSource);
  const out: GetRoute[] = [];
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*get\(\s*(["'`])([^"'`]*)\2/g)) {
    const rest = source.slice(m.index! + m[0].length);
    const end = rest.search(NEXT_DECLARATION);
    const whole = end === -1 ? rest : rest.slice(0, end);
    const cut = whole.search(HANDLER_START);
    const header = cut === -1 ? whole : whole.slice(0, cut);
    const body = cut === -1 ? "" : whole.slice(cut);
    const inlineAuthorizeRoles = [...header.matchAll(/authorize\(\s*\[([^\]]*)\]\s*\)/g)].map((a) =>
      [...a[1].matchAll(/["'](\w+)["']/g)].map((r) => r[1]),
    );
    const guards = [...header.replace(/authorize\(\s*\[[^\]]*\]\s*\)/g, " ").matchAll(/\b(authenticate|is[A-Z]\w*|guardBy\w+|garde\w*)\b/g)].map((g) => g[1]);
    const mountPrefix = mounts.get(m[1]) ?? "";
    out.push({
      file,
      path: m[3],
      key: `${file} GET ${mountPrefix}${m[3]}`,
      header,
      body,
      guards,
      inlineAuthorizeRoles,
      mountPrefix,
      routerVar: m[1],
    });
  }
  return out;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function isWorkOrderRead(route: Pick<GetRoute, "path" | "mountPrefix">): boolean {
  return /work-orders\/:|:workOrderId/.test(route.path) || (route.mountPrefix.includes("work-orders") && /:/.test(route.path));
}

/** Le contrôle de cloison apparaît-il avant le premier envoi de donnée ? */
export function scopeCheckedBeforeSend(body: string, markers: RegExp[]): boolean {
  const sendAt = body.search(DATA_SEND);
  return markers.some((marker) => {
    const at = body.search(marker);
    return at !== -1 && (sendAt === -1 || at < sendAt);
  });
}

/**
 * Verdict sur une lecture. `fileGuards` : gardes posées sur tout le routeur (`router.use(guard)`)
 * ou à son montage. Une route sans aucune garde de session (publique) n'est pas jugée ici.
 */
export function judgeGetRoute(route: GetRoute, kinds: GuardKinds, fileGuards: string[] = []): Verdict {
  const guards = [...fileGuards, ...route.guards];
  const excludesClient =
    guards.some((g) => kinds.restrictive.has(g) || (!kinds.permissive.has(g) && !/^is[A-Z]/.test(g))) ||
    route.inlineAuthorizeRoles.some((roles) => !roles.includes("client"));
  if (excludesClient) return { ok: true };
  const sessionOnly = guards.length > 0 || route.inlineAuthorizeRoles.length > 0;
  if (!sessionOnly) return { ok: true };
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

/** Gardes posées sur tout un routeur par `router.use(guard)` (sans chemin). */
export function routerLevelGuards(rawSource: string): Map<string, string[]> {
  const source = stripComments(rawSource);
  const out = new Map<string, string[]>();
  for (const m of source.matchAll(/\b(\w+)\s*\.\s*use\(\s*((?:(?:is[A-Z]\w*|authenticate|garde\w*)\s*,?\s*)+)\)/g)) {
    out.set(m[1], [...(out.get(m[1]) ?? []), ...[...m[2].matchAll(/[\w]+/g)].map((g) => g[0])]);
  }
  return out;
}

/** Montages de `server/api/index.ts` : variable importée -> { préfixe, gardes au montage, fichier }. */
export function parseMounts(indexSource: string): Array<{ variable: string; prefix: string; guards: string[]; file: string | null }> {
  const source = stripComments(indexSource);
  const importedFrom = new Map<string, string>();
  for (const m of source.matchAll(/import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["']\.\/([\w.-]+)["']/g)) {
    const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!).filter(Boolean);
    for (const name of names) importedFrom.set(name, m[3]);
  }
  const out: Array<{ variable: string; prefix: string; guards: string[]; file: string | null }> = [];
  for (const m of source.matchAll(/\bapiRouter\s*\.\s*use\(\s*["']([^"']+)["']\s*,([^;]*?)\)\s*;/gs)) {
    const parts = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    const variable = parts[parts.length - 1];
    if (!/^\w+$/.test(variable)) continue;
    const guards = parts.slice(0, -1).flatMap((p) => [...p.matchAll(/\b(is[A-Z]\w*|authenticate|garde\w*)\b/g)].map((g) => g[1]));
    out.push({ variable, prefix: m[1], guards, file: importedFrom.get(variable) ?? null });
  }
  return out;
}

/** Parcourt `server/` et renvoie les lectures GET ouvertes à un client sans cloison (clé `fichier GET chemin`). */
export function scanOpenGetReads(serverDir: string, roleConstants: Record<string, readonly string[] | undefined>) {
  const kinds = classifyAuthGuards(readFileSync(join(serverDir, "middleware", "auth.ts"), "utf8"), roleConstants);
  const mounts = parseMounts(readFileSync(join(serverDir, "api", "index.ts"), "utf8"));
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const path of sourceFiles(serverDir)) {
    const file = `server/${path.slice(serverDir.length + 1).replace(/\\/g, "/")}`;
    const raw = readFileSync(path, "utf8");
    const fileMounts = mounts.filter((m) => m.file && file === `server/api/${m.file}.ts`);
    const routerGuards = routerLevelGuards(raw);
    for (const route of extractGetRoutes(file, raw)) {
      // un fichier peut exporter plusieurs routeurs : on rattache par variable, sinon au seul montage connu
      const mount = fileMounts.find((m) => m.variable === route.routerVar) ?? (fileMounts.length === 1 ? fileMounts[0] : undefined);
      const prefix = mount?.prefix ?? "";
      const full = { ...route, mountPrefix: prefix, key: `${file} GET ${prefix}${route.path}` };
      seen.add(full.key);
      const verdict = judgeGetRoute(full, kinds, [...(mount?.guards ?? []), ...(routerGuards.get(route.routerVar) ?? [])]);
      if (!verdict.ok) offenders.push(full.key);
    }
  }
  return { offenders: offenders.sort(), seen };
}
