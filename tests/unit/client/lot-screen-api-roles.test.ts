import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOT_SCREENS } from "@/config/lot-screens";
import * as sharedRoles from "@shared/constants/roles";

/**
 * Garde-fou : les rôles d'un écran du lot (`client/src/config/lot-screens.ts`) doivent
 * être ceux de la route qu'il lit (`server/api/*.routes.ts`).
 *
 * Les deux listes vivaient en deux endroits sans contrat : un écran ouvert à un rôle
 * que l'API refusait (pointage pour la logistique, mouvements de pneus pour le
 * secrétariat) affichait un 403 ; un rôle autorisé par l'API sans écran n'avait pas
 * de menu. Voir `docs/analysis/LESSONS_LEARNED.md`.
 *
 * Les gardes sont lues dans la source (un test unitaire ne peut pas monter les
 * routeurs : `server/db.ts` exige une base). Une garde que ce test ne sait pas lire
 * le fait échouer : on l'apprend ici plutôt que de la laisser passer. Un identifiant
 * (dont `...IDENT`) n'est résolu que par une constante locale ou un import réel de
 * `@shared/constants/roles` ; un simple homonyme fait échouer le test.
 *
 * Angles morts (ce test ne les voit pas) :
 * - `SCREEN_APIS` est tenu à la main : un écran qui appelle une route de plus, ou une
 *   autre route que celle déclarée, n'est contrôlé que si on l'ajoute ici.
 * - Les gardes posées par `router.use(...)` dans le fichier du routeur ne sont pas
 *   lues : seules comptent celles de la déclaration de route et du montage dans
 *   `server/api/index.ts` (préfixe de chemin refusé).
 * - Les contrôles faits dans le handler ou le service (`req.user.role === ...`,
 *   `canAccessOwned`, filtres par rôle) ne sont pas vus : d'où `apiWider`.
 * - Seuls les `server/api/*.routes.ts` sont lus ; une route encore servie par
 *   `server/routes.ts` n'est pas couverte.
 */

type Api = { file: string; method?: "get" | "post" | "patch"; path: string };
type Declaration =
  | { apis: Api[]; /** L'API sert plus de rôles que l'écran : raison écrite obligatoire. */ apiWider?: string;
      /** Écart connu qui attend une décision métier : test en `it.todo`, écart écrit en clair. */
      pending?: string }
  | { stub: string; reason: string }
  | { none: string };

const SCREEN_APIS: Record<string, Declaration> = {
  "admin-locked-users": { apis: [{ file: "auth-lockout.routes.ts", path: "/admin/users/locked" }] },
  "admin-audit-logs": { apis: [{ file: "audit-logs.routes.ts", path: "/audit-logs" }] },
  "admin-vehicle-document-types": {
    apis: [{ file: "vehicle-document-types.routes.ts", path: "/vehicle-document-types" }],
    apiWider: "référentiel lu par tout le personnel dans les formulaires de document ; l'écran est celui de son administration",
  },
  "admin-backups": { apis: [{ file: "backups.routes.ts", path: "/admin/backups" }] },
  scope: { none: "page statique, sans appel d'API" },
  "incident-declare": {
    apis: [{ file: "incidents.routes.ts", method: "post", path: "/incidents" }],
    apiWider: "le service tranche par rôle (client refusé, chauffeur limité à ses affectations actives)",
  },
  "incidents-list": {
    apis: [{ file: "incidents.routes.ts", path: "/incidents" }],
    apiWider: "le service filtre la liste selon le rôle de l'appelant",
  },
  "wo-history": { apis: [{ file: "work-order-audit-trail.routes.ts", path: "/work-orders/:id/audit-trail" }] },
  "wo-quality-check": { apis: [{ file: "quality-check.routes.ts", method: "post", path: "/work-orders/:id/quality-check" }] },
  "oil-change-intervals": { none: "écran d'attente, pas encore d'API" },
  "tire-movements": { apis: [{ file: "tire-movements.routes.ts", path: "/tires/movements" }] },
  // Aucune route de lecture pour les bons et les anomalies : l'écran n'a que l'action d'écriture.
  "fuel-vouchers": {
    apis: [{ file: "fuel-vouchers.routes.ts", method: "post", path: "/fuel-vouchers/:id/validate" }],
    pending:
      "écran admin, logistics, secretary, workshop_manager, management ; API admin, logistics, secretary (isFuelCardManager). " +
      "workshop_manager et management reçoivent les événements carburant (realtime-events) mais aucune route ne leur sert les bons : " +
      "retirer ces rôles de l'écran, ou ajouter une lecture qui les admet ?",
  },
  "fuel-anomalies": {
    apis: [{ file: "fuel-anomalies.routes.ts", method: "patch", path: "/fuel-card/anomalies/:id" }],
    pending:
      "écran admin, logistics, secretary, workshop_manager, management ; API admin, logistics, secretary (isFuelCardManager). " +
      "Même question que les bons : retirer workshop_manager et management de l'écran, ou leur ouvrir une lecture des anomalies ?",
  },
  "fuel-prices": {
    apis: [{ file: "fuel-prices.routes.ts", path: "/fuel-prices" }],
    apiWider: "prix lus par tout le personnel (isStaff) ; l'écran est celui de leur gestion. Saisie (POST) : isFuelCardManager",
  },
  "vehicle-cost": { apis: [{ file: "vehicle-cost-summary.routes.ts", path: "/vehicles/:id/cost-summary" }] },
  "time-tracking": {
    apis: [
      { file: "time-tracking.routes.ts", path: "/time-tracking" },
      { file: "time-tracking.routes.ts", path: "/time-tracking/monthly-stats" },
    ],
  },
  "pending-invoices": { apis: [{ file: "pending-invoices.routes.ts", path: "/billing/pending-invoices" }] },
};

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const AUTH_SRC = read("server/middleware/auth.ts");
const INDEX_SRC = read("server/api/index.ts");
const ALL = new Set<string>(sharedRoles.ALL_APP_ROLES);

/** Contenu entre la parenthèse ouvrante `open` et sa fermante. */
function inside(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("parenthèse non fermée");
}

/** Découpe sur les virgules de premier niveau (hors chaînes, crochets, parenthèses, accolades). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function localConst(name: string, src: string): string | undefined {
  const m = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*`).exec(src);
  if (!m) return undefined;
  const from = m.index + m[0].length;
  // Expression jusqu'au `;` de premier niveau.
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth === 0) return src.slice(from, i).trim();
  }
  throw new Error(`constante ${name} illisible`);
}

/**
 * Nom exporté par `@shared/constants/roles` sous lequel `local` est réellement importé
 * dans `src` (`import { A, B as local } from "@shared/constants/roles"`), sinon undefined.
 * Un identifiant qui porte seulement le même nom qu'une constante partagée ne compte pas.
 */
function sharedImportOf(local: string, src: string): string | undefined {
  const re = /import\s*\{([^}]*)\}\s*from\s*["'](?:@shared|(?:\.\.\/)+shared)\/constants\/roles["']/g;
  for (const m of src.matchAll(re)) {
    for (const spec of m[1].split(",")) {
      const parts = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      if ((parts[1] ?? parts[0]) === local && !/^type\s/.test(spec.trim())) return parts[0];
    }
  }
  return undefined;
}

function roleArray(expr: string, src: string): Set<string> {
  const e = expr.trim();
  if (e.startsWith("[") && e.endsWith("]")) {
    const roles = new Set<string>();
    for (const item of splitArgs(e.slice(1, -1))) {
      const lit = /^["'](\w+)["']$/.exec(item);
      if (lit) roles.add(lit[1]);
      else if (item.startsWith("...")) roleArray(item.slice(3), src).forEach((r) => roles.add(r));
      else throw new Error(`élément de rôle illisible : ${item}`);
    }
    return roles;
  }
  const filter = /^(\w+)\.filter\(\(?(\w+)\)?\s*=>\s*\2\s*!==\s*["'](\w+)["']\)$/.exec(e);
  if (filter) {
    const base = roleArray(filter[1], src);
    base.delete(filter[3]);
    return base;
  }
  if (/^\w+$/.test(e)) {
    // Une constante locale masque un import du même nom : elle passe en premier.
    const def = localConst(e, src);
    if (def) return roleArray(def.replace(/\s+as\s+const$/, ""), src);
    const shared = sharedImportOf(e, src);
    if (shared) {
      const value = (sharedRoles as Record<string, unknown>)[shared];
      if (Array.isArray(value)) return new Set(value as string[]);
      throw new Error(`${shared} n'est pas une liste de rôles de @shared/constants/roles`);
    }
    throw new Error(`${e} n'est ni une constante locale ni un import de @shared/constants/roles`);
  }
  throw new Error(`liste de rôles illisible : ${e}`);
}

type Guard = { kind: "neutral" } | { kind: "session" } | { kind: "roles"; roles: Set<string> };

function guardOf(token: string, src: string): Guard {
  const t = token.trim();
  if (/^requireFeature\(/.test(t)) return { kind: "neutral" };
  if (t === "authenticate") return { kind: "session" };
  const auth = /^authorize\(([\s\S]*)\)$/.exec(t);
  if (auth) return { kind: "roles", roles: roleArray(auth[1], src) };
  if (/^\w+$/.test(t)) {
    const local = localConst(t, src);
    if (local) return guardOf(local, src);
    const exported = localConst(t, AUTH_SRC);
    if (exported?.startsWith("sessionGuard(")) {
      // Garde écrite à la main (isAdmin) : un seul rôle comparé en dur.
      const only = /user\.role\s*!==\s*["'](\w+)["']/.exec(exported);
      if (only) return { kind: "roles", roles: new Set([only[1]]) };
    } else if (exported) return guardOf(exported, AUTH_SRC);
  }
  throw new Error(`garde illisible : ${t}`);
}

/** Rôles effectivement admis par la route : intersection des gardes du montage et de la route. */
function apiRoles(api: Api): Set<string> {
  const src = read(`server/api/${api.file}`);
  const method = api.method ?? "get";
  const route = new RegExp(`router\\.${method}\\(\\s*["'\`]${escapeRe(api.path)}["'\`]`).exec(src);
  if (!route) throw new Error(`${method.toUpperCase()} ${api.path} introuvable dans ${api.file}`);
  const args = splitArgs(inside(src, src.indexOf("(", route.index)));
  const guards = args.slice(1, -1).map((a) => guardOf(a, src));

  const routerVar = new RegExp(`import\\s+(\\w+)\\s+from\\s+["']\\./${escapeRe(api.file.replace(/\.ts$/, ""))}["']`).exec(INDEX_SRC)?.[1];
  if (!routerVar) throw new Error(`${api.file} n'est pas monté dans server/api/index.ts`);
  const mount = [...INDEX_SRC.matchAll(/apiRouter\.use\(/g)]
    .map((m) => splitArgs(inside(INDEX_SRC, m.index! + m[0].length - 1)))
    .find((a) => a[a.length - 1] === routerVar);
  if (!mount) throw new Error(`montage de ${routerVar} introuvable`);
  if (mount.some((a) => /^["'`]/.test(a))) throw new Error(`${routerVar} monté sous un préfixe : chemin à revoir`);
  guards.push(...mount.slice(0, -1).map((a) => guardOf(a, INDEX_SRC)));

  const roleSets = guards.filter((g): g is Extract<Guard, { kind: "roles" }> => g.kind === "roles").map((g) => g.roles);
  if (roleSets.length === 0 && !guards.some((g) => g.kind === "session")) {
    throw new Error(`${method.toUpperCase()} ${api.path} : aucune garde de session`);
  }
  return roleSets.reduce((acc, s) => new Set([...acc].filter((r) => s.has(r))), new Set(ALL));
}

const sorted = (s: Iterable<string>) => [...s].sort();

describe("rôles des écrans du lot = rôles des routes qu'ils lisent", () => {
  it("chaque écran du lot est déclaré ici, et rien d'autre", () => {
    expect(sorted(Object.keys(SCREEN_APIS))).toEqual(sorted(LOT_SCREENS.map((s) => s.id)));
  });

  for (const screen of LOT_SCREENS) {
    const decl = SCREEN_APIS[screen.id];
    if (!decl) continue;
    const screenRoles = new Set<string>(screen.roles === "authenticated" ? ALL : screen.roles);

    if ("none" in decl) continue;

    if ("stub" in decl) {
      it(`${screen.id} : la route est encore un squelette (sinon, déclarer sa route ici)`, () => {
        expect(read(`server/api/${decl.stub}`)).toContain("createStubRouter(");
      });
      continue;
    }

    for (const api of decl.apis) {
      if (decl.pending) {
        it.todo(`${screen.id} : ${(api.method ?? "get").toUpperCase()} ${api.path} : ÉCART À TRANCHER : ${decl.pending}`);
        continue;
      }
      it(`${screen.id} : ${(api.method ?? "get").toUpperCase()} ${api.path}`, () => {
        const allowed = apiRoles(api);
        // L'écran ne s'ouvre à aucun rôle que l'API refuse (sinon : un 403 à l'écran).
        expect(sorted([...screenRoles].filter((r) => !allowed.has(r))), "rôles de l'écran refusés par l'API").toEqual([]);
        // L'API ne sert aucun rôle privé d'écran, sauf exception écrite.
        if (!decl.apiWider) {
          expect(sorted([...allowed].filter((r) => !screenRoles.has(r))), "rôles admis par l'API sans écran").toEqual([]);
        }
      });
    }
  }

  it("le lecteur de gardes refuse ce qu'il ne comprend pas", () => {
    expect(() => guardOf("monGardeMaison", "")).toThrow(/garde illisible/);
    expect(guardOf("isAdmin", "")).toEqual({ kind: "roles", roles: new Set(["admin"]) });
    expect(sorted((guardOf("isStaff", "") as { roles: Set<string> }).roles)).toEqual(sorted(sharedRoles.STAFF_ROLES));
    expect(sorted((guardOf("isAnyUser", "") as { roles: Set<string> }).roles)).toEqual(sorted(sharedRoles.ALL_APP_ROLES));
    expect(sorted((guardOf('authorize(["admin", "secretary"])', "") as { roles: Set<string> }).roles)).toEqual(["admin", "secretary"]);
  });

  it("un `...IDENT` ou un identifiant n'est lu dans les constantes partagées que s'il en est importé", () => {
    const roles = (src: string) => sorted((guardOf("authorize([...TIRE_MOVEMENT_ROLES])", src) as { roles: Set<string> }).roles);
    // Même nom, jamais importé : refusé, au lieu d'être lu en silence dans les constantes partagées.
    expect(() => roles("")).toThrow(/ni une constante locale ni un import/);
    expect(() => roles('import type { TIRE_MOVEMENT_ROLES } from "@shared/constants/roles";')).toThrow(/ni une constante locale/);
    expect(() => roles('import { TIRE_MOVEMENT_ROLES } from "@shared/constants/other";')).toThrow(/ni une constante locale/);
    // Réellement importé (alias compris) : valeur partagée.
    expect(roles('import { TIRE_MOVEMENT_ROLES } from "@shared/constants/roles";')).toEqual(sorted(sharedRoles.TIRE_MOVEMENT_ROLES));
    expect(roles('import { STAFF_ROLES as TIRE_MOVEMENT_ROLES } from "../../shared/constants/roles";')).toEqual(
      sorted(sharedRoles.STAFF_ROLES),
    );
    // Une constante locale du même nom masque la constante partagée.
    expect(
      roles('import { TIRE_MOVEMENT_ROLES as X } from "@shared/constants/roles";\nconst TIRE_MOVEMENT_ROLES = ["admin"];'),
    ).toEqual(["admin"]);
  });
});
