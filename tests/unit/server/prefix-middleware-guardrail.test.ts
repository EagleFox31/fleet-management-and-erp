import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { scanFiles, scanMountedMiddlewares, type MountedMiddleware } from "../../support/prefix-middleware-scan";
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
  { name: "requireFeature", type: "sans-base", source: "server/lib/feature-flags.ts", raison: "lit le drapeau de fonctionnalite en memoire/environnement (404 si coupe) ; aucun acces base" },
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
const ATTENDUS_TOLERES_ABSENTS: Array<{ name: string; raison: string }> = [
  { name: "routeIdRangeGuard", raison: "borne des identifiants de route (a venir) : doit etre sans base, valider le format avant toute lecture" },
];

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SERVER_DIR = join(ROOT, "server");

const occurrences = (): MountedMiddleware[] => scanFiles(sourceFiles(SERVER_DIR), ROOT);
const entriesFor = (o: MountedMiddleware) => MIDDLEWARES_JUSTIFIES.filter((e) => e.name === o.name && (!e.file || e.file === o.file));
const isDerogation = (o: MountedMiddleware) => DEROGATIONS_CONNUES.some((d) => d.name === o.name && d.file === o.file);
const isExpected = (o: MountedMiddleware) => ATTENDUS_TOLERES_ABSENTS.some((a) => a.name === o.name);
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
    const offenders = MIDDLEWARES_JUSTIFIES.filter((e) => e.type === "sans-base" && e.source).flatMap((e) => {
      const text = readFileSync(join(ROOT, e.source!), "utf8");
      return /from\s+["'][^"']*\/db["']|from\s+["'][^"']*\/storage["']|from\s+["'][^"']*\/services\//.test(text) ? [`${e.name} (${e.source})`] : [];
    });
    expect(offenders, "Un middleware declare sans-base importe la base ou un service : reclasser l'entree apres lecture.").toEqual([]);
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
