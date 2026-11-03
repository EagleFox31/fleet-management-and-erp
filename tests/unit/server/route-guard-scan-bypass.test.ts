import { describe, expect, it } from "vitest";
import {
  classifyAuthGuards,
  extendKinds,
  extractGetRoutes,
  judgeGetRoute,
  routerLevelGuards,
} from "../../support/route-guard-scan";

/**
 * Contournements du scan des lectures GET ouvertes (#176) : chaque fixture trompait le scan sur
 * main (route ouverte au client jugée cloisonnée). Le scan doit les refuser toutes, et continuer
 * d'accepter les formes saines voisines. Juge comme `scanOpenGetReads` : gardes de routeur posées
 * avant la route seulement.
 */

const roles = { STAFF_ROLES: ["admin", "technician"], ALL_ROLES: ["admin", "technician", "client"] };
const auth = `export const isStaff = authorize([...STAFF_ROLES]); export const isAnyUser = authorize([...ALL_ROLES]);`;
const base = classifyAuthGuards(auth, roles);

function verdicts(src: string): boolean[] {
  const kinds = extendKinds(base, src);
  return extractGetRoutes("server/api/fixture.ts", src).map((route) => {
    const routerGuards = routerLevelGuards(src, kinds, route.at);
    return judgeGetRoute(route, kinds, routerGuards.get(route.routerVar) ?? []).ok;
  });
}

const OPEN = `async (req, res) => { res.json(await all()); }`;

const BYPASSES: Record<string, string> = {
  "A : alias d'import d'une garde permissive sous un nom restrictif": `import { authenticate as isStaff } from "../middleware/auth";\nrouter.get("/x", isStaff, ${OPEN});`,
  "B : garde restrictive redéclarée localement": `const isStaff = (req, res, next) => next();\nrouter.get("/x", isStaff, ${OPEN});`,
  "B : garde restrictive redéclarée en fonction": `function isStaff(req, res, next) { next(); }\nrouter.get("/x", isStaff, ${OPEN});`,
  "C : router.use(garde) posé après la route": `router.get("/x", authenticate, ${OPEN});\nrouter.use(isStaff);`,
  "D : répartiteur qui laisse passer par next()": `const g = sessionGuard((req, res, next) => { if (req.query.a) return isStaff(req, res, next); next(); });\nrouter.get("/x", g, ${OPEN});`,
  "E : marqueur de cloison dans une chaîne": `router.get("/x", authenticate, async (req, res) => { log.debug("ownerScopeOf skipped"); res.json(await all()); });`,
  "E : marqueur de cloison dans un gabarit": "router.get(\"/x\", authenticate, async (req, res) => { log.debug(`canAccessOwned ${1}`); res.json(await all()); });",
  "F : donnée envoyée dans une réponse 4xx avant le contrôle": `router.get("/x", authenticate, async (req, res) => { if (!req.query.ok) return res.status(404).json(await all()); if (!(await canAccessOwned(req.user, f))) return res.status(403).end(); res.json(1); });`,
  "G : périmètre calculé puis jamais utilisé": `router.get("/x", isAnyUser, async (req, res) => { const s = ownerScopeOf(req.user); res.json(await all()); });`,
  "G : canAccessOwned dont le résultat est jeté": `router.get("/x", isAnyUser, async (req, res) => { await canAccessOwned(req.user, f); res.json(await all()); });`,
  "témoin : session seule, aucun contrôle": `router.get("/x", authenticate, ${OPEN});`,
};

const HEALTHY: Record<string, string> = {
  "garde restrictive importée sans alias": `import { isStaff } from "../middleware/auth";\nrouter.get("/x", isStaff, ${OPEN});`,
  "alias d'une garde restrictive": `import { isStaff as staffOnly } from "../middleware/auth";\nrouter.get("/x", staffOnly, ${OPEN});`,
  "router.use(garde) posé avant la route": `router.use(isStaff);\nrouter.get("/x", authenticate, ${OPEN});`,
  "répartiteur entre gardes restrictives": `const g = sessionGuard((req, res, next) => (req.query.a ? isStaff : isAdmin)(req, res, next));\nrouter.get("/x", g, ${OPEN});`,
  "réponse 4xx avec message littéral avant le contrôle": `router.get("/x", isAnyUser, async (req, res) => { if (!req.user) return res.status(401).json({ message: "Non authentifié" }); if (!(await canAccessOwned(req.user, f))) return res.status(403).json({ message: "Accès refusé" }); res.json(await all()); });`,
  "périmètre calculé et utilisé": `router.get("/x", isAnyUser, async (req, res) => { const scope = ownerScopeOf(req.user); res.json(await list(scope)); });`,
  "contrôle de rôle client": `router.get("/x", isAnyUser, async (req, res) => { if (req.user.role === "client") return res.status(403).end(); res.json(await all()); });`,
  "assertWorkOrderReadable en instruction seule": `router.get("/work-orders/:id", isAnyUser, async (req, res) => { await assertWorkOrderReadable(req.user, id); res.json(await one()); });`,
};

describe("scan des lectures GET : contournements refusés (#176)", () => {
  for (const [name, src] of Object.entries(BYPASSES)) {
    it(`refuse ${name}`, () => {
      expect(verdicts(src)).toEqual([false]);
    });
  }
});

describe("scan des lectures GET : formes saines acceptées", () => {
  for (const [name, src] of Object.entries(HEALTHY)) {
    it(`accepte ${name}`, () => {
      expect(verdicts(src)).toEqual([true]);
    });
  }
});
