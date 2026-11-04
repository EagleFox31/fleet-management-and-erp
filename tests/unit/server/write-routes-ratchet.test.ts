import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ALL_APP_ROLES } from "../../../shared/constants/roles";
import {
  T1_WITHOUT_ROLE_GUARD,
  T3_WITHOUT_BODY_VALIDATION,
  T4_WITHOUT_SERVER_FIELD_PROTECTION,
} from "./support/write-routes-frozen";
import { SELF_SERVICE_ROUTES } from "./support/write-routes-self-service";
import {
  AUTH_ROLE_GUARDS,
  LOCAL_ROLE_GUARDS,
  MOUNT_ROLE_GUARDS,
  PUBLIC_BY_DESIGN,
  resolveRoles,
  serverDir,
  allWriteRoutes,
  hasRoleGuard,
  isPassThrough,
  mountOrder,
  mountPrefixes,
  unreadableDeclarations,
  protectsServerFields,
  readsBody,
  validatesBody,
  writeRoutesOf,
  type WriteRoute,
} from "./support/write-routes-scan";

/**
 * Cliquets T1, T3 et T4 de docs/qa/PLAN_COUVERTURE_MODULES.md sur toutes les routes d'écriture
 * (POST / PUT / PATCH / DELETE) de `server/routes.ts` et `server/api/*.routes.ts`.
 *
 *  - T1 : une garde de rôle (ou de permission) dans la déclaration ou au montage du routeur ;
 *  - T3 : un corps lu dans `req.body` passe par Zod, `prepareColumnUpdate` ou `columnTypeErrors` ;
 *  - T4 : les champs que seul le serveur écrit (`createdBy`, `updatedBy`, montants...) ne passent
 *    pas du corps à la base.
 *
 * Les listes gelées (./support/write-routes-frozen.ts) recensent l'existant. Le test échoue dans
 * les deux sens : une nouvelle route non conforme, ou une route gelée devenue conforme et pas
 * retirée de la liste. Une liste ne peut que rétrécir.
 *
 * Limite : analyse statique du texte. Un handler passé par référence (`router.post(p, g, handler)`)
 * n'est pas lu pour T3/T4 ; un contrôle fait dans une fonction appelée n'est pas vu. Une route
 * dans ce cas reste dans la liste gelée tant qu'elle n'affiche pas son contrôle dans le handler.
 */

const routes = allWriteRoutes();
const withBody = routes.filter(readsBody);

function check(label: string, current: WriteRoute[], frozen: readonly string[], frozenName: string, advice: string) {
  const now = new Set(current.map((r) => r.key));
  const fresh = [...now].filter((k) => !frozen.includes(k));
  const stale = frozen.filter((k) => !now.has(k));
  expect(
    fresh,
    `${label} : route(s) d'écriture non conforme(s). ${advice} N'ajoute pas la route à ${frozenName} : corrige-la.`,
  ).toEqual([]);
  expect(
    stale,
    `${label} : entrée(s) de ${frozenName} devenue(s) conforme(s) ou supprimée(s). Retire-les de tests/unit/server/support/write-routes-frozen.ts : la liste ne peut que rétrécir.`,
  ).toEqual([]);
}

describe("détection des routes d'écriture", () => {
  const src = (code: string, mounted = { prefix: "/api/x", guarded: false }) => writeRoutesOf(code, () => mounted);

  it("repère méthode, chemin préfixé et middlewares ; ignore les lectures", () => {
    const [post, patch, ...rest] = src(
      `router.get("/a", authenticate, async (req, res) => {});
       router.post("/", authenticate, isStaff, async (req, res) => {});
       router.patch("/:id", authorize(["admin", "x"]), async (req, res) => {});`,
    );
    expect(rest).toEqual([]);
    expect(post.key).toBe("post /api/x");
    expect(post.middlewares).toEqual(["isStaff"]);
    expect(patch.key).toBe("patch /api/x/:id");
    expect(patch.middlewares).toEqual(['authorize(["admin", "x"])']);
  });

  it("T1 : authenticate seul, isAnyUser, drapeau de fonctionnalité et téléversement ne sont pas des gardes de rôle", () => {
    for (const mw of ["authenticate", "isAnyUser", 'requireFeature("f")', "upload.single('d')", "requireAuth"]) {
      const [r] = src(`router.post("/y", ${mw}, async (req, res) => {});`);
      expect(hasRoleGuard(r), mw).toBe(false);
    }
    const [guarded] = src(`router.post("/y", authenticate, isWorkshopManager, async (req, res) => {});`);
    expect(hasRoleGuard(guarded)).toBe(true);
    const [mounted] = src(`router.post("/y", async (req, res) => {});`, { prefix: "/api/x", guarded: true });
    expect(hasRoleGuard(mounted)).toBe(true);
  });

  it("T1 : un handler passé par référence n'est pas pris pour un garde", () => {
    const [r] = src(`router.post("/z", markAllRead);\nrouter.delete("/z", isAnyUser, removeIt);`);
    expect(r.middlewares).toEqual([]);
    expect(hasRoleGuard(r)).toBe(false);
  });

  it("T3 : le corps lu sans validation est repéré, DELETE et routes sans corps sont hors périmètre", () => {
    const [bad, ok, prepared, del, noBody] = src(
      `router.post("/a", isAdmin, async (req, res) => { await db.insert(t).values(req.body); });
       router.post("/b", isAdmin, async (req, res) => { const d = insertTSchema.parse(req.body); });
       router.patch("/c", isAdmin, async (req, res) => { const { data } = prepareColumnUpdate(t, req.body); });
       router.delete("/d", isAdmin, async (req, res) => { const x = req.body; });
       router.post("/e", isAdmin, async (req, res) => { res.json({}); });`,
    );
    expect([bad, ok, prepared].map(readsBody)).toEqual([true, true, true]);
    expect([bad, ok, prepared].map(validatesBody)).toEqual([false, true, true]);
    expect(readsBody(del)).toBe(false);
    expect(readsBody(noBody)).toBe(false);
  });

  it("T4 : schéma qui expose un champ serveur = non protégé ; écrasement, retrait ou liste de champs = protégé", () => {
    const [exposed, clean, overwrite, strip, picked, bare] = src(
      `router.post("/a", isAdmin, async (req, res) => { insertWorkOrderSchema.parse(req.body); });
       router.post("/b", isAdmin, async (req, res) => { insertPartSchema.parse(req.body); });
       router.post("/c", isAdmin, async (req, res) => { const v = { ...req.body, createdBy: req.user.id }; });
       router.post("/d", isAdmin, async (req, res) => { const v = req.body; delete v.updatedBy; });
       router.post("/e", isAdmin, async (req, res) => { const { name, plate } = req.body; });
       router.post("/f", isAdmin, async (req, res) => { await db.insert(t).values(req.body); });`,
    );
    expect(
      [exposed, clean, overwrite, strip, picked, bare].map(protectsServerFields),
    ).toEqual([false, true, true, true, true, false]);
  });

  it("T4 : un schéma local qui déclare un champ serveur n'est pas protecteur", () => {
    const code = `const okSchema = z.object({ name: z.string() });
const leakSchema = z.object({ name: z.string(), createdBy: z.number() });
router.post("/a", isAdmin, async (req, res) => { okSchema.parse(req.body); });
router.post("/b", isAdmin, async (req, res) => { leakSchema.parse(req.body); });`;
    const [ok, leak] = src(code);
    expect(protectsServerFields(ok)).toBe(true);
    expect(protectsServerFields(leak)).toBe(false);
  });

  it("validateBody seul n'est pas une garde de rôle (T1), mais vaut validation (T3)", () => {
    const [bare, guarded] = src(
      `router.post("/a", validateBody(insertVehicleSchema), async (req, res) => { await save(req.body); });
       router.post("/b", isAdmin, validateBody(insertVehicleSchema), async (req, res) => { await save(req.body); });`,
    );
    expect([bare, guarded].map(hasRoleGuard)).toEqual([false, true]);
    expect([bare, guarded].map(validatesBody)).toEqual([true, true]);
  });

  it("T4 : validateBody sans keep protège ; avec keep, le schéma est jugé", () => {
    const code = `const leakSchema = z.object({ name: z.string(), cost: z.number() });
const okSchema = z.object({ name: z.string() });
router.post("/a", isAdmin, validateBody(leakSchema), async (req, res) => { await save(req.body); });
router.post("/b", isAdmin, validateBody(leakSchema, { keep: ["cost"] }), async (req, res) => { await save(req.body); });
router.post("/c", isAdmin, validateBody(okSchema, { keep: ["cost"] }), async (req, res) => { await save(req.body); });`;
    expect(src(code).map(protectsServerFields)).toEqual([true, false, true]);
  });

  it("T1 : liste positive, un middleware inconnu ne vaut pas garde", () => {
    for (const mw of ["[isAnyUser]", "...guards", "anyone", "authorize([...ALL_ROLES])", "checkWritePermission", "isAnyUser", "selfScoped", "isAdminLike"]) {
      const [r] = src(`router.post("/y", ${mw}, async (req, res) => { res.json({}); });`);
      expect(hasRoleGuard(r), mw).toBe(false);
    }
    for (const mw of ["isAdmin", "isStaff", "isWorkshopManager", 'authorize(["admin"])', "authorize([...PROCUREMENT_ROLES])"]) {
      const [r] = src(`router.post("/y", ${mw}, async (req, res) => { res.json({}); });`);
      expect(hasRoleGuard(r), mw).toBe(true);
    }
    expect(AUTH_ROLE_GUARDS.has("isAdmin")).toBe(true);
    expect(AUTH_ROLE_GUARDS.has("isAnyUser")).toBe(false);
  });

  it("T1 : authorize juge l'ensemble de rôles résolu, pas le nom de la constante (NO-GO n°3)", () => {
    const code = `const EVERYONE = ALL_APP_ROLES;
const anyone = [...ALL_APP_ROLES];
const STAFF_PLUS_CLIENT = [...STAFF_ROLES, "client"];
const FEW = ["admin", "warehouse"];
router.post("/a", authorize([...ALL_APP_ROLES]), async (req, res) => { res.json({}); });
router.post("/b", authorize(ALL_APP_ROLES), async (req, res) => { res.json({}); });
router.post("/c", authorize([...EVERYONE]), async (req, res) => { res.json({}); });
router.post("/d", authorize(anyone), async (req, res) => { res.json({}); });
router.post("/e", authorize([...STAFF_PLUS_CLIENT]), async (req, res) => { res.json({}); });
router.post("/f", authorize([...STAFF_ROLES, ...CLIENT_ONLY]), async (req, res) => { res.json({}); });
router.post("/g", authorize(roles.ALL_APP_ROLES), async (req, res) => { res.json({}); });
router.post("/h", authorize([...FEW]), async (req, res) => { res.json({}); });
router.post("/i", authorize([...STAFF_ROLES]), async (req, res) => { res.json({}); });`;
    expect(src(code).map(hasRoleGuard)).toEqual([false, false, false, false, false, false, false, true, true]);
    expect(resolveRoles("[...STAFF_ROLES, \"client\"]", "")).toEqual(new Set(ALL_APP_ROLES));
  });

  it("T1 : une garde locale ou un export is* qui admet tous les rôles ne vaut pas garde", () => {
    const local = `const writers = authorize([...ALL_APP_ROLES]);
router.post("/y", writers, async (req, res) => { res.json({}); });`;
    const [r] = src(local);
    expect(hasRoleGuard({ ...r, file: "api/time-tracking.routes.ts" })).toBe(false);
    const alias = `const writers = isAnyUser;
router.post("/y", writers, async (req, res) => { res.json({}); });`;
    const [a] = src(alias);
    expect(hasRoleGuard({ ...a, file: "api/time-tracking.routes.ts" })).toBe(false);
    const [kept] = src(`const writers = authorize(["admin"]);
router.post("/y", writers, async (req, res) => { res.json({}); });`);
    expect(hasRoleGuard({ ...kept, file: "api/time-tracking.routes.ts" })).toBe(true);
    const mount = mountPrefixes(
      `import tRoutes from "./t.routes";
const gardeApprovisionnement = authorize([...ALL_APP_ROLES]);
apiRouter.use("/t", gardeApprovisionnement, tRoutes);`,
    );
    expect(mount.get("api/t.routes.ts")?.guarded).toBe(false);
    for (const name of AUTH_ROLE_GUARDS) expect(name).not.toBe("isAnyUser");
    expect(AUTH_ROLE_GUARDS.has("isStaff")).toBe(true);
  });

  it("T1 : une garde locale ne vaut que dans son fichier", () => {
    const [r] = src(
      `const checkWritePermission = (req, res, next) => { if (!PROCUREMENT.has(req.user.role)) return next(denied()); next(); };
router.post("/y", checkWritePermission, async (req, res) => { res.json({}); });`,
    );
    expect(hasRoleGuard({ ...r, file: "api/purchase-orders.routes.ts" })).toBe(true);
    // Nom listé mais non défini dans la source : pas de garde.
    const [undefinedGuard] = src(`router.post("/y", checkWritePermission, async (req, res) => { res.json({}); });`);
    expect(hasRoleGuard({ ...undefinedGuard, file: "api/purchase-orders.routes.ts" })).toBe(false);
    expect(hasRoleGuard({ ...r, file: "api/vehicles.routes.ts" })).toBe(false);
  });

  it("T1 : chaque garde locale de la liste est définie dans son fichier et ne vaut pas isAnyUser", () => {
    for (const [file, names] of Object.entries(LOCAL_ROLE_GUARDS)) {
      const source = readFileSync(join(serverDir, file), "utf8");
      for (const name of names) {
        const def = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([^\\n]*)`).exec(source)?.[1];
        expect(def, `${name} absent de ${file}`).toBeDefined();
        expect(def, `${name} (${file})`).not.toMatch(/\bisAnyUser\b|\bALL_ROLES\b|\bauthenticate\b/);
      }
    }
    const index = readFileSync(join(serverDir, "api", "index.ts"), "utf8");
    for (const name of MOUNT_ROLE_GUARDS.map((n) => n.replace(/^\.\.\./, ""))) {
      expect(new RegExp(`\\bconst\\s+${name}\\s*=|\\bimport\\s*\\{[^}]*\\b${name}\\b`).test(index), name).toBe(true);
    }
  });

  it("T1 : montage gardé par un drapeau seul = non gardé ; router.use(garde) garde les déclarations suivantes", () => {
    const flagOnly = mountPrefixes(`import tRoutes from "./t.routes";\napiRouter.use("/t", requireFeature("gps"), tRoutes);`);
    expect(flagOnly.get("api/t.routes.ts")?.guarded).toBe(false);
    const staff = mountPrefixes(`import tRoutes from "./t.routes";\napiRouter.use("/t", isStaff, tRoutes);`);
    expect(staff.get("api/t.routes.ts")?.guarded).toBe(true);
    const [before, after] = src(
      `router.post("/a", async (req, res) => { res.json({}); });
       router.use(isAdmin);
       router.post("/b", async (req, res) => { res.json({}); });`,
    );
    expect([before, after].map(hasRoleGuard)).toEqual([false, true]);
    const [flag] = src(`router.use(requireFeature("x"));\nrouter.post("/c", async (req, res) => { res.json({}); });`);
    expect(hasRoleGuard(flag)).toBe(false);
  });

  it("déclarations illisibles (.route, .all, apostrophes, routeur non reconnu) : repérées", () => {
    expect(unreadableDeclarations(`router.route("/a").post(isAdmin, h);`)).toHaveLength(1);
    expect(unreadableDeclarations(`router.all("/a", h);`)).toHaveLength(1);
    expect(unreadableDeclarations(`router.post('/a', isAdmin, h);`)).toHaveLength(1);
    expect(unreadableDeclarations(`router.patch(path, isAdmin, h);`)).toHaveLength(1);
    expect(unreadableDeclarations(`const r = Router();\nr.post("/a", isAdmin, h);`).length).toBeGreaterThan(0);
    expect(unreadableDeclarations(`const router = Router();\nrouter.post("/a", isAdmin, h);\nrouter.get(p, h);`)).toEqual([]);
  });

  it("aucune déclaration illisible dans server/api ni server/routes.ts", () => {
    const files = [...readdirSync(join(serverDir, "api")).filter((f) => f.endsWith(".ts")).map((f) => join("api", f)), "routes.ts"];
    const found = files.flatMap((f) => unreadableDeclarations(readFileSync(join(serverDir, f), "utf8")).map((u) => `${f} : ${u}`));
    expect(found, "Écris la route sous la forme router.post(\"/chemin\", garde, handler) : sinon elle échappe aux cliquets.").toEqual([]);
  });

  it("B1 : ownedBy n'est pas une garde T1, et sa fonction interne ne coupe pas l'en-tête", () => {
    const [owned] = src(
      `router.patch("/:id", ...ownedBy((req) => ownerOf(Number(req.params.id))), validateBody(leakSchema, { keep: ["cost"] }), async (req, res) => { await save(req.body); });`,
    );
    expect(hasRoleGuard(owned)).toBe(false);
    expect(owned.middlewares.map((m) => m.split("(")[0])).toEqual(["...ownedBy", "validateBody"]);
  });

  it("T4 : validateBody avec schéma permissif ou options en variable ne vaut pas protection", () => {
    const code = `const openSchema = z.object({ name: z.string() }).passthrough();
const okSchema = z.object({ name: z.string() });
router.post("/a", isAdmin, validateBody(openSchema), async (req, res) => { await save(req.body); });
router.post("/b", isAdmin, validateBody(okSchema.passthrough()), async (req, res) => { await save(req.body); });
router.post("/c", isAdmin, validateBody(okSchema, opts), async (req, res) => { await save(req.body); });
router.post("/d", isAdmin, validateBody(okSchema, { serverFields: ["status"] }), async (req, res) => { await save(req.body); });`;
    const routes = src(code);
    expect(routes.map(protectsServerFields)).toEqual([false, false, false, true]);
  });

  it("T4 : keep en forme abrégée et options en spread ne valent pas retrait garanti", () => {
    const code = `const leakSchema = z.object({ name: z.string(), cost: z.number() });
router.post("/a", isAdmin, validateBody(leakSchema, { keep }), async (req, res) => { await save(req.body); });
router.post("/b", isAdmin, validateBody(leakSchema, { ...opts }), async (req, res) => { await save(req.body); });
router.post("/c", isAdmin, validateBody(leakSchema, { serverFields: ["x"], ...opts }), async (req, res) => { await save(req.body); });
router.post("/d", isAdmin, validateBody(leakSchema), async (req, res) => { await save(req.body); });`;
    expect(src(code).map(protectsServerFields)).toEqual([false, false, false, true]);
  });

  it("l'analyse voit bien les déclarations des sources", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(withBody.length).toBeGreaterThan(60);
    expect(routes.some((r) => r.key === "post /api/vehicles")).toBe(true);
    expect(routes.some((r) => r.key === "patch /api/work-order-items/:id" || r.key.startsWith("patch /api/work-order-items/"))).toBe(true);
  });

  it("lit server/api avant routes.ts : server/app.ts monte apiRouter avant registerRoutes", () => {
    const app = readFileSync(join(serverDir, "app.ts"), "utf8");
    expect(app.indexOf('app.use("/api", apiRouter)')).toBeGreaterThan(-1);
    expect(app.indexOf('app.use("/api", apiRouter)')).toBeLessThan(app.indexOf("registerRoutes(app)"));
    const key = "post /api/fuel-card/consumption";
    const served = routes.find((r) => r.key === key);
    expect(served?.file).toBe("api/fuel-card.routes.ts");
    expect(served ? hasRoleGuard(served) : false).toBe(true);
    const fromRoutesTs = routes.filter((r) => r.file === "routes.ts");
    expect(fromRoutesTs.length).toBeGreaterThan(0);
    expect(routes.filter((r) => r.file === undefined)).toEqual([]);
  });

  it("l'ordre de montage de server/api/index.ts est celui du service", () => {
    const order = mountOrder(readFileSync(join(serverDir, "api", "index.ts"), "utf8"));
    expect(order.length).toBeGreaterThan(20);
    expect(order.indexOf("api/pin-auth.routes.ts")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("api/pin-auth.routes.ts")).toBeLessThan(order.indexOf("api/vehicles.routes.ts"));
    expect(new Set(order).size).toBe(order.length);
  });

  it("un garde qui rend la main par next() ne masque pas la vraie route et lui prête ses middlewares", () => {
    const [guard, real] = src(
      `router.patch("/t", authenticate, isAdmin, (req, _res, next) => { return next(); });
       router.patch("/u", isAdmin, async (req, res) => { res.json({}); next(); });`,
    );
    expect(isPassThrough(guard)).toBe(true);
    expect(isPassThrough(real)).toBe(false);
    const toggle = routes.find((r) => r.key === "patch /api/admin/users/:id/toggle");
    expect(toggle?.file).toBe("routes.ts");
    expect(toggle?.middlewares).toContain("isAdmin");
  });

  it("les routes ouvertes par conception existent encore", () => {
    const keys = new Set(routes.map((r) => r.key));
    expect([...PUBLIC_BY_DESIGN].filter((k) => !keys.has(k))).toEqual([]);
  });
});

describe("cliquets sur les routes d'écriture", () => {
  it("T1 : toute route d'écriture a une garde de rôle", () => {
    check(
      "T1",
      routes.filter((r) => !hasRoleGuard(r) && !PUBLIC_BY_DESIGN.has(r.key) && !(r.key in SELF_SERVICE_ROUTES)),
      T1_WITHOUT_ROLE_GUARD,
      "T1_WITHOUT_ROLE_GUARD",
      "Ajoute une garde de rôle (`isStaff`, `isWorkshopManager`, `authorize([...])`...) sur la déclaration, ou monte le routeur derrière une garde dans server/api/index.ts.",
    );
  });

  it("T3 : tout corps lu est validé", () => {
    check(
      "T3",
      withBody.filter((r) => !validatesBody(r)),
      T3_WITHOUT_BODY_VALIDATION,
      "T3_WITHOUT_BODY_VALIDATION",
      "Valide `req.body` avec un schéma Zod (`safeParse`) ou `prepareColumnUpdate(table, req.body)` et réponds 400 avec le message du champ, jamais 500.",
    );
  });

  it("T4 : aucun champ serveur ne passe du corps à la base", () => {
    check(
      "T4",
      withBody.filter((r) => !protectsServerFields(r)),
      T4_WITHOUT_SERVER_FIELD_PROTECTION,
      "T4_WITHOUT_SERVER_FIELD_PROTECTION",
      "Valide avec un schéma d'insertion qui omet `createdBy`/`updatedBy`/montants (shared/schema.ts, `.omit`), ou écrase ces champs depuis `req.user` / le serveur, ou ne retiens que les champs nommés.",
    );
  });

  it("libre-service (exception T1) : isAnyUser déclaré et contrat de périmètre présent", () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    const root = join(serverDir, "..");
    for (const [key, entry] of Object.entries(SELF_SERVICE_ROUTES)) {
      const route = byKey.get(key);
      expect(route, `${key} : route libre-service introuvable, retire-la de write-routes-self-service.ts`).toBeDefined();
      expect(route!.middlewares, `${key} : une route libre-service déclare isAnyUser (compte de session chargé)`).toContain("isAnyUser");
      expect(hasRoleGuard(route!), `${key} : a une garde de rôle, ce n'est plus une exception, retire-la`).toBe(false);
      expect(T1_WITHOUT_ROLE_GUARD, `${key} : à la fois gelée T1 et libre-service`).not.toContain(key);
      expect(PUBLIC_BY_DESIGN.has(key), `${key} : publique et libre-service`).toBe(false);
      let contract = "";
      try {
        contract = readFileSync(join(root, entry.contract), "utf8");
      } catch {
        // contrat absent : l'assertion suivante le dit
      }
      expect(contract, `${key} : contrat ${entry.contract} introuvable`).not.toBe("");
      expect(contract.includes(entry.calls), `${key} : ${entry.contract} n'appelle pas la route (${entry.calls})`).toBe(true);
    }
  });

  it("les listes gelées n'ont pas de doublon", () => {
    for (const list of [T1_WITHOUT_ROLE_GUARD, T3_WITHOUT_BODY_VALIDATION, T4_WITHOUT_SERVER_FIELD_PROTECTION]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
