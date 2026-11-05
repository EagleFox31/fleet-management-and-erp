import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { firstRouterMountLine, forbiddenImports, forbiddenImportsDeep, forbiddenInAnonymousMounts, fsModuleReader, importSourceOf, routeIdGuardIssues, scanFiles, scanMountedMiddlewares, staleDerogations, type MountedMiddleware, type ReadModule } from "../../support/prefix-middleware-scan";
import { sourceFiles } from "../../support/route-guard-scan";

/**
 * Garde-fou : tout middleware monte sur un prefixe (ou sur toute l'application) est inscrit et justifie.
 *
 * Regle. Un middleware monte par `app.use(...)`, `apiRouter.use(prefixe, mw, routeur)` ou `router.use(mw)`
 * s'execute AVANT les gardes de role des routes qu'il precede. Il ne doit donc ni lire ni ecrire une
 * donnee metier avant que le role soit verifie. Chaque middleware recense dans `server/` (hors
 * `_archive`) doit etre :
 *   - une garde de session ou de role (`garde-role`), ou
 *   - inscrit ci-dessous avec la raison pour laquelle il peut preceder les gardes de role
 *     (`sans-base`, `ecrit-apres-reponse`, `indexe-par-session`, `pre-authentification`, `hors-api`), ou
 *   - declare dans `DEROGATIONS_CONNUES` (ecart constate, a corriger : la liste ne doit que rétrécir).
 *
 * Que faire quand ce test echoue pour un middleware nouveau :
 *   1. lire le middleware : accede-t-il a la base, a un fichier, a un service externe avant la garde de role ?
 *   2. si oui, deplacer l'acces apres la garde de role (ou monter la garde de role avant lui) ;
 *   3. sinon, ajouter une entree a `MIDDLEWARES_JUSTIFIES` avec la raison reelle (pas un copier-coller).
 *
 * Le recensement lit l'AST TypeScript (`tests/support/prefix-middleware-scan.ts`) : un `.use(` sur
 * plusieurs lignes, un spread ou un appel de fabrique est vu comme un montage simple.
 */

type Type = "garde-role" | "sans-base" | "ecrit-apres-reponse" | "indexe-par-session" | "pre-authentification" | "hors-api";

interface Entree {
  name: string;
  /** Restreint l'entree a un fichier ; sinon valable partout. */
  file?: string;
  type: Type;
  raison: string;
  /** Fichier du middleware, relu pour verifier l'absence d'acces base (type `sans-base`). */
  source?: string;
  /** Nombre exact de montages attendus (obligatoire pour les fonctions anonymes). */
  occurrences?: number;
}

const APP = "server/app.ts";
const INDEX = "server/api/index.ts";
const VITE = "server/vite.ts";

const MIDDLEWARES_JUSTIFIES: Entree[] = [
  // Gardes de session et de role : ce sont elles, les gardes. Leur declaration est verifiee plus bas.
  { name: "authenticate", type: "garde-role", raison: "refuse sans session (401)" },
  { name: "isAnyUser", type: "garde-role", raison: "refuse sans session (401) et charge req.user pour les routes ouvertes aux clients" },
  { name: "isStaff", type: "garde-role", raison: "refuse tout role hors personnel (403)" },
  { name: "isAdmin", type: "garde-role", raison: "reserve a l'administrateur (403)" },
  { name: "isTechnician", type: "garde-role", raison: "reserve aux roles atelier (403)" },
  { name: "isWorkshopManager", type: "garde-role", raison: "reserve aux chefs d'atelier et admin (403)" },
  { name: "authorize", type: "garde-role", raison: "liste de roles explicite par montage (403)" },
  { name: "sessionGuard", type: "garde-role", raison: "marque une garde de session ; enveloppe un repartiteur de gardes (/suppliers)" },
  { name: "exportsGuard", type: "garde-role", raison: "tableau [drapeau, isAnyUser, matrice de roles par export] : refus par defaut" },
  { name: "gardeApprovisionnement", type: "garde-role", raison: "authorize(PROCUREMENT_ROLES) pose en constante locale" },
  { name: "(anonyme)@/health/details", file: INDEX, type: "garde-role", occurrences: 1, raison: "gestionnaire final de la route : isAdmin le precede dans la meme chaine, il ne s'execute qu'apres la garde" },
  { name: `(anonyme)@/part-sales`, file: INDEX, type: "garde-role", occurrences: 1, raison: "repartiteur : GET/HEAD passent, toute ecriture est confiee a authorize(PART_SALE_ROLES)" },

  // Fichier server/app.ts : pile globale, avant le routeur /api.
  { name: "requestContext", file: APP, type: "sans-base", source: "server/middleware/error-handler.ts", raison: "pose requestId et l'en-tete X-Request-Id ; ne lit que les en-tetes de la requete" },
  { name: "accessLog", file: APP, type: "ecrit-apres-reponse", source: "server/middleware/error-handler.ts", raison: "journal pino sur `finish` (methode, chemin, statut, userId), sans corps ni lecture de donnee" },
  { name: "errorResponseGuard", file: APP, type: "sans-base", source: "server/middleware/error-handler.ts", raison: "enveloppe res.json pour normaliser les erreurs >= 400 ; aucune lecture avant la reponse" },
  { name: "compression", file: APP, type: "sans-base", raison: "compression de la reponse, sans etat metier" },
  { name: "(anonyme)@*", file: APP, type: "sans-base", occurrences: 2, raison: "deux fonctions : en-tetes Cache-Control sur /api, puis CORS (en-tetes d'origine, OPTIONS -> 204) ; aucun acces base" },
  { name: "express.json", file: APP, type: "sans-base", raison: "analyse du corps JSON (limite par defaut d'Express)" },
  { name: "express.urlencoded", file: APP, type: "sans-base", raison: "analyse du corps urlencoded" },
  { name: "express.static", file: APP, type: "sans-base", raison: "fichiers statiques publics du dossier public/, hors /api" },
  { name: "ipFailureLimit", file: APP, type: "sans-base", source: "server/middleware/auth-ip-limit.ts", raison: "plafond d'echecs par adresse IP sur /api/auth/login et /api/auth/pin-login ; compteur en memoire, route de connexion non authentifiee par nature" },
  { name: "apiNotFound", file: APP, type: "sans-base", source: "server/middleware/error-handler.ts", raison: "monte apres tous les routeurs /api : leve un 404 sans rien lire" },
  { name: "errorHandler", file: APP, type: "sans-base", source: "server/middleware/error-handler.ts", raison: "dernier middleware : normalise l'erreur et la journalise" },

  // Fichier server/api/index.ts : routeur /api.
  { name: "sessionMiddleware", file: INDEX, type: "indexe-par-session", raison: "charge la session par l'identifiant du cookie ; precede par definition les gardes de role, ne lit rien d'autre" },
  { name: "sessionMiddleware", file: "server/routes.ts", type: "indexe-par-session", raison: "meme instance que celle de server/api/index.ts, montee pour les routes historiques" },
  { name: "(anonyme)@/auth/login", file: INDEX, type: "pre-authentification", occurrences: 1, raison: "valide le corps de la connexion (schema Zod) avant le compteur ; route publique, aucune base" },
  { name: "(anonyme)@/auth/pin-login", file: INDEX, type: "pre-authentification", occurrences: 1, raison: "ramene l'identifiant a sa forme canonique avant le compteur ; route publique, aucune base" },
  { name: "(anonyme)@/health", file: INDEX, type: "pre-authentification", occurrences: 1, raison: "route de sante publique : reponse JSON statique, aucun acces base" },
  { name: "validateBody", file: INDEX, type: "sans-base", source: "server/middleware/validate-body.ts", raison: "valide le corps par un schema Zod (400), retire les champs serveur ; aucune base" },
  { name: "loginLockoutGuard", file: INDEX, type: "pre-authentification", raison: "verrou de connexion monte sur /auth/login et /auth/pin-login uniquement (routes publiques, il n'existe pas de role a ce stade) ; compteur indexe par identifiant normalise, corps invalide ecarte avant" },
  { name: "auditWrites", file: INDEX, type: "ecrit-apres-reponse", source: "server/middleware/audit-writes.ts", raison: "n'ecrit qu'apres la reponse (`finish`, statut < 400), ne lit aucune donnee metier ; enregistrement non bloquant" },
  { name: "idempotencyGuard", file: INDEX, type: "indexe-par-session", raison: "ne s'active que pour les routes de IDEMPOTENCY_ROUTES, drapeau offline-writes (coupe par defaut), en-tete present et session ouverte ; reserve une cle indexee par userId et ne lit aucune donnee metier" },
  { name: "requireFeature", file: INDEX, type: "sans-base", source: "server/lib/feature-flags.ts", raison: "lit le drapeau de fonctionnalite en memoire/environnement (404 si coupe) ; aucun acces base" },
  // Surveillance : routes de vite.ts, jamais atteintes par /api (montees apres apiNotFound, developpement et statique).
  { name: "vite.middlewares", file: VITE, type: "hors-api", raison: "serveur de developpement Vite, monte apres apiNotFound : une requete /api n'y arrive jamais" },
  { name: "express.static", file: VITE, type: "hors-api", raison: "fichiers du build client, monte apres apiNotFound" },
  { name: "(anonyme)@*", file: VITE, type: "hors-api", occurrences: 2, raison: "deux replis vers index.html (developpement et statique), montes apres apiNotFound" },
];

/** Derogations suivies dans une PR liee. La liste doit retrecir. */
const DEROGATIONS_CONNUES: Array<{ name: string; file: string; raison: string }> = [
  {
    name: "workOrderBookingGuard",
    file: INDEX,
    raison:
      "derogation suivie, voir PR liee",
  },
];

/** Middlewares annonces par d'autres lots : tolerés absents, inscrits des maintenant pour ne pas bloquer leur arrivee. */
const ATTENDUS_TOLERES_ABSENTS: Array<{ name: string; file?: string; raison: string }> = [
  { name: "routeIdRangeGuard", file: INDEX, raison: "borne des identifiants de route (a venir) : doit etre sans base, valider le format avant toute lecture" },
];

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVER_DIR = join(ROOT, "server");

const occurrences = (): MountedMiddleware[] => scanFiles(sourceFiles(SERVER_DIR), ROOT);
const entriesFor = (o: MountedMiddleware) => MIDDLEWARES_JUSTIFIES.filter((e) => e.name === o.name && (!e.file || e.file === o.file));
const isDerogation = (o: MountedMiddleware) => DEROGATIONS_CONNUES.some((d) => d.name === o.name && d.file === o.file);
const isExpected = (o: MountedMiddleware) => ATTENDUS_TOLERES_ABSENTS.some((a) => a.name === o.name && (!a.file || a.file === o.file));
const describeMount = (o: MountedMiddleware) => `${o.file}:${o.line}  ${o.receiver}.${o.method}(${o.prefix ? JSON.stringify(o.prefix) + ", " : ""}${o.name})`;

describe("middlewares montes sur un prefixe : recensement et liste blanche", () => {
  it("chaque middleware monte est inscrit avec sa raison (ou est une derogation connue)", () => {
    const unknown = occurrences().filter((o) => entriesFor(o).length === 0 && !isDerogation(o) && !isExpected(o));
    expect(
      unknown.map(describeMount),
      "Middleware monte sur un prefixe sans inscription. Il s'execute AVANT les gardes de role. " +
        "1) Lire le middleware : touche-t-il la base, un fichier ou un service avant la garde de role ? " +
        "2) Si oui, monter la garde de role avant lui ou deplacer l'acces apres elle. " +
        "3) Sinon, l'inscrire dans MIDDLEWARES_JUSTIFIES de tests/unit/server/prefix-middleware-guardrail.test.ts avec la raison reelle.",
    ).toEqual([]);
  });

  it("les fonctions anonymes sont comptees : un montage de plus echoue", () => {
    const all = occurrences();
    const wrong = MIDDLEWARES_JUSTIFIES.filter((e) => e.occurrences !== undefined).flatMap((e) => {
      const n = all.filter((o) => o.name === e.name && (!e.file || e.file === o.file)).length;
      return n === e.occurrences ? [] : [`${e.file ?? "*"} ${e.name} : ${n} montage(s) trouve(s), ${e.occurrences} inscrit(s)`];
    });
    expect(wrong, "Une fonction anonyme montee ne se justifie pas par son nom : la nommer (const) ou ajuster `occurrences` apres lecture.").toEqual([]);
  });

  it("aucune inscription perimee : chaque entree correspond a un montage reel", () => {
    const all = occurrences();
    const stale = MIDDLEWARES_JUSTIFIES.filter((e) => !all.some((o) => o.name === e.name && (!e.file || e.file === o.file)));
    expect(
      stale.map((e) => `${e.file ?? "*"} ${e.name}`),
      "Entree sans montage : la retirer de MIDDLEWARES_JUSTIFIES (la liste blanche ne doit pas survivre au code).",
    ).toEqual([]);
  });

  it("une derogation connue ou attendue n'est jamais aussi justifiee (pas de double statut)", () => {
    const names = new Set(MIDDLEWARES_JUSTIFIES.map((e) => e.name));
    const both = [...DEROGATIONS_CONNUES, ...ATTENDUS_TOLERES_ABSENTS].filter((e) => names.has(e.name)).map((e) => e.name);
    expect(both).toEqual([]);
  });

  it("chaque entree porte une raison substantielle", () => {
    const thin = [...MIDDLEWARES_JUSTIFIES, ...DEROGATIONS_CONNUES, ...ATTENDUS_TOLERES_ABSENTS].filter((e) => e.raison.trim().length < 25);
    expect(thin.map((e) => e.name)).toEqual([]);
  });

  it("les middlewares « sans-base » n'importent pas la base dans leur fichier source", () => {
    const offenders = MIDDLEWARES_JUSTIFIES.filter((e) => e.type === "sans-base" && e.source).flatMap((e) =>
      forbiddenImportsDeep(readFileSync(join(ROOT, e.source!), "utf8"), e.source!, fsModuleReader(ROOT)).map((chain) => `${e.name} : ${chain}`),
    );
    expect(offenders, "Un middleware declare sans-base importe la base ou un service : reclasser l'entree apres lecture.").toEqual([]);
  });

  it("une entree sans-base du projet cite sa source (seules les bibliotheques en sont dispensees)", () => {
    const LIBRARY = /^(compression|express\.(json|urlencoded|static))$/;
    const missing = MIDDLEWARES_JUSTIFIES.filter((e) => e.type === "sans-base" && !e.source && !LIBRARY.test(e.name) && !e.name.startsWith("("));
    expect(missing.map((e) => e.name), "Entree sans-base sans `source` : le fichier du middleware doit etre relu par le test.").toEqual([]);
  });

  it("R2 : la detection d'imports couvre import statique, import(), require et re-export", () => {
    expect(forbiddenImports('import { db } from "../db";', "x.ts")).toEqual(["../db"]);
    expect(forbiddenImports('import type { db } from "../db";', "x.ts")).toEqual([]);
    expect(forbiddenImports('const m = await import("../storage");', "x.ts")).toEqual(["../storage"]);
    expect(forbiddenImports('const s = require("../services/stock");', "x.ts")).toEqual(["../services/stock"]);
    expect(forbiddenImports('export { db } from "../db";', "x.ts")).toEqual(["../db"]);
    expect(forbiddenImports(['import { eq } from "drizzle-orm";', 'import pg from "pg";'].join("\n"), "x.ts")).toEqual(["drizzle-orm", "pg"]);
    expect(forbiddenImports('import { x } from "../lib/pure";', "x.ts")).toEqual([]);
  });

  it("R1 : une derogation sans montage correspondant est detectee comme perimee", () => {
    const mounts: MountedMiddleware[] = [{ file: INDEX, line: 1, receiver: "apiRouter", method: "use", prefix: "/x", name: "vivante" }];
    expect(staleDerogations([{ name: "vivante", file: INDEX }, { name: "disparue", file: INDEX }, { name: "vivante", file: APP }], mounts)).toEqual([`${INDEX} disparue`, `${APP} vivante`]);
  });

  it("R1 : chaque derogation connue correspond a un montage reel", () => {
    expect(staleDerogations(DEROGATIONS_CONNUES, occurrences()), "Derogation sans montage : la retirer de DEROGATIONS_CONNUES (elle a ete corrigee).").toEqual([]);
  });

  it("R3 : routeIdRangeGuard s'applique partout (sans prefixe, sur apiRouter, avant les routeurs)", () => {
    const m = (over: Partial<MountedMiddleware>): MountedMiddleware => ({ file: INDEX, line: 5, receiver: "apiRouter", method: "use", prefix: null, name: "routeIdRangeGuard", ...over });
    expect(routeIdGuardIssues([m({})], { [INDEX]: 10 })).toEqual([]);
    expect(routeIdGuardIssues([m({ prefix: "/vehicles" })], { [INDEX]: 10 })).toHaveLength(1);
    expect(routeIdGuardIssues([m({ receiver: "router" })], { [INDEX]: 10 })).toHaveLength(1);
    expect(routeIdGuardIssues([m({ line: 12 })], { [INDEX]: 10 })).toHaveLength(1);
  });

  it("R3 : s'il est monte dans le code reel, il respecte la regle", () => {
    const text = readFileSync(join(ROOT, INDEX), "utf8");
    const first = firstRouterMountLine(text, INDEX);
    expect(routeIdGuardIssues(occurrences(), first === undefined ? {} : { [INDEX]: first })).toEqual([]);
  });

  it("R4 : un routeur se reconnait a sa declaration ou a son import, pas a son nom", () => {
    const seen = scanMountedMiddlewares(
      ['import vehiclesRoutes from "./vehicles.routes";', "const auditRouter = Router();", "const fooRoutes = (req, res, next) => next();", 'apiRouter.use("/v", vehiclesRoutes, auditRouter, fooRoutes);'].join("\n"),
      INDEX,
    ).map((x) => x.name);
    expect(seen).toEqual(["fooRoutes"]);
  });

  it("R6 : un receveur se decouvre par sa declaration, pas par une liste figee", () => {
    const seen = scanMountedMiddlewares(["const adminApi = express.Router();", 'adminApi.use("/z", leak);'].join("\n"), INDEX).map((x) => x.name);
    expect(seen).toEqual(["leak"]);
  });

  it("les gardes inscrites existent reellement (declarees dans server/middleware ou le routeur)", () => {
    const sources = [...sourceFiles(join(SERVER_DIR, "middleware")), join(ROOT, INDEX)].map((p) => readFileSync(p, "utf8")).join("\n");
    const missing = MIDDLEWARES_JUSTIFIES.filter((e) => e.type === "garde-role" && !e.name.startsWith("(")).filter(
      (e) => !new RegExp(`(export\\s+)?(const|function)\\s+${e.name}\\b`).test(sources),
    );
    expect(missing.map((e) => e.name), "Garde inscrite mais introuvable : nom change ou supprime ?").toEqual([]);
  });

  it("le recensement voit les montages multi-lignes, les spreads et les verbes de connexion", () => {
    const seen = scanMountedMiddlewares(
      [
        'import xRoutes from "./x.routes";',
        "apiRouter.use(",
        '  "/x",',
        "  requireFeature(\"a\"),",
        "  ...gardes,",
        "  fooMiddleware,",
        "  xRoutes,",
        ");",
        "router.use(authenticate);",
        'app.use("/api", apiRouter);',
        'apiRouter.post("/auth/login", (req, res, next) => next(), lockout());',
      ].join("\n"),
      "server/api/index.ts",
    ).map((m) => `${m.prefix ?? "*"}:${m.name}`);
    expect(seen).toEqual(["/x:requireFeature", "/x:gardes", "/x:fooMiddleware", "*:authenticate", "/auth/login:(anonyme)@/auth/login", "/auth/login:lockout"]);
  });
});

const mem =
  (files: Record<string, string>): ReadModule =>
  (spec, from) => {
    if (!spec.startsWith(".")) return undefined;
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : ".";
    const out: string[] = [];
    for (const x of `${dir}/${spec}`.split("/")) {
      if (x === "..") out.pop();
      else if (x !== ".") out.push(x);
    }
    const file = `${out.join("/")}.ts`;
    return files[file] === undefined ? undefined : { file, source: files[file] };
  };

describe("lot de suivi : R2 imports transitifs et fonctions anonymes", () => {
  const files = {
    "server/middleware/a.ts": 'import { helper } from "../lib/h";',
    "server/lib/h.ts": 'import { db } from "../db";',
  };
  it("R2 : un import interdit atteint par un module relatif est refuse, avec sa chaine", () => {
    expect(forbiddenImportsDeep(files["server/middleware/a.ts"], "server/middleware/a.ts", mem(files))).toEqual(["server/middleware/a.ts > server/lib/h.ts > ../db"]);
  });
  it("R2 : une chaine saine ou cyclique ne produit aucun ecart", () => {
    const ok = { "a/x.ts": 'import "./y";', "a/y.ts": 'import "./x";' };
    expect(forbiddenImportsDeep(ok["a/x.ts"], "a/x.ts", mem(ok))).toEqual([]);
  });
  it("R2 : le corps d'une fonction anonyme montee est analyse via ses identifiants importes", () => {
    const src = [
      'import { helper } from "../lib/h";',
      'import { clean } from "../lib/clean";',
      "apiRouter.use((req, res, next) => { helper(); next(); });",
      "apiRouter.use((req, res, next) => { clean(); next(); });",
    ].join("\n");
    const all = { ...files, "server/lib/clean.ts": "export const clean = () => 1;" };
    const out = forbiddenInAnonymousMounts(src, "server/api/index.ts", mem(all));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("server/api/index.ts:3");
    expect(out[0]).toContain("../db");
  });
  it("R2 : la source d'une entree est celle que le fichier de montage importe reellement", () => {
    const src = 'import { guard } from "../middleware/a";\nrouter.use(guard);';
    expect(importSourceOf(src, "server/api/index.ts", "guard", mem(files))).toBe("server/middleware/a.ts");
    expect(importSourceOf(src, "server/api/index.ts", "autre", mem(files))).toBeUndefined();
  });
  it("R2 : dans le code reel, la source inscrite est le module importe (ou le fichier lui-meme)", () => {
    const read = fsModuleReader(ROOT);
    const wrong = MIDDLEWARES_JUSTIFIES.filter((e) => e.type === "sans-base" && e.source && e.file).flatMap((e) => {
      const real = importSourceOf(readFileSync(join(ROOT, e.file!), "utf8"), e.file!, e.name, read);
      return real === e.source || (real === undefined && e.source === e.file) ? [] : [`${e.name} : inscrit ${e.source}, importe ${real ?? "(non importe)"}`];
    });
    expect(wrong).toEqual([]);
  });
  it("R2 : aucune fonction anonyme montee du code reel n'atteint la base", () => {
    const read = fsModuleReader(ROOT);
    const out = [INDEX, APP].flatMap((f) => forbiddenInAnonymousMounts(readFileSync(join(ROOT, f), "utf8"), f, read));
    expect(out).toEqual([]);
  });
});

describe("lot de suivi : R3, R4, R6 et fichier des attendus", () => {
  const m = (over: Partial<MountedMiddleware>): MountedMiddleware => ({ file: INDEX, line: 5, receiver: "apiRouter", method: "use", prefix: null, name: "routeIdRangeGuard", ...over });
  it("R3 : le montage dans app.ts (sans prefixe ou sur /api, avant le routeur) est accepte", () => {
    expect(routeIdGuardIssues([m({ file: APP, receiver: "app", prefix: "/api" })], { [APP]: 10 })).toEqual([]);
    expect(routeIdGuardIssues([m({ file: APP, receiver: "app" })], { [APP]: 10 })).toEqual([]);
  });
  it("R3 : un montage ailleurs, sur un autre receveur ou apres le routeur est refuse", () => {
    expect(routeIdGuardIssues([m({ file: "server/api/vehicles.routes.ts" })], {})).toHaveLength(1);
    expect(routeIdGuardIssues([m({ file: APP, receiver: "apiRouter" })], { [APP]: 10 })).toHaveLength(1);
    expect(routeIdGuardIssues([m({ file: APP, receiver: "app", prefix: "/api/x" })], { [APP]: 10 })).toHaveLength(1);
    expect(routeIdGuardIssues([m({ file: APP, receiver: "app", line: 20 })], { [APP]: 10 })).toHaveLength(1);
  });
  it("R3 : le premier montage compte un routeur importe par nom, apiRouter et registerRoutes(app)", () => {
    const files = { "server/api/x.routes.ts": "export const xRoutes = Router();" };
    const named = ['import { xRoutes } from "./x.routes";', "const a = 1;", 'apiRouter.use("/x", xRoutes);'].join("\n");
    expect(firstRouterMountLine(named, INDEX, mem(files))).toBe(3);
    expect(firstRouterMountLine(["const a = 1;", 'app.use("/api", apiRouter);'].join("\n"), APP)).toBe(2);
    expect(firstRouterMountLine(["const a = 1;", "registerRoutes(app);"].join("\n"), APP)).toBe(2);
  });
  it("R4 : un import nomme n'est un routeur que si le module l'exporte comme tel", () => {
    const files = { "server/api/x.routes.ts": "export const xRoutes = Router();\nexport const guard = (req, res, next) => next();" };
    const src = ['import { xRoutes, guard } from "./x.routes";', 'apiRouter.use("/x", xRoutes, guard);'].join("\n");
    expect(scanMountedMiddlewares(src, INDEX, mem(files)).map((x) => x.name)).toEqual(["guard"]);
  });
  it("R6 : un receveur se decouvre aussi par son type declare et par une fabrique typee", () => {
    const typed = [
      "function mount(r: Router, e: Express) {",
      '  r.use("/a", leakA);',
      '  e.use("/b", leakB);',
      "}",
      "const build = (): express.Router => Router();",
      "const made = build();",
      'made.use("/c", leakC);',
      "const t: Application = make();",
      't.use("/d", leakD);',
    ].join("\n");
    expect(scanMountedMiddlewares(typed, INDEX).map((x) => x.name)).toEqual(["leakA", "leakB", "leakC", "leakD"]);
  });
  it("attendus : la tolerance d'absence est propre a son fichier", () => {
    expect(isExpected(m({ file: INDEX }))).toBe(true);
    expect(isExpected(m({ file: "server/api/autre.ts" }))).toBe(false);
  });
});
