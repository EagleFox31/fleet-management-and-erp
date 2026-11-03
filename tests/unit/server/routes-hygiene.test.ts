import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import * as roles from "../../../shared/constants/roles";
import {
  classifyAuthGuards,
  extractGetRoutes,
  judgeGetRoute,
  routerLevelGuards,
  scanOpenGetReads,
  sourceFiles,
  stripComments,
} from "../../support/route-guard-scan";

/**
 * Garde-fous issus d'incidents réels (LESSONS_LEARNED, 29 octobre 2026 et suivants).
 *
 * 1. Routes déclarées deux fois dans `server/routes.ts` : Express sert la
 *    première, la seconde est du code mort qui a l'air vivant. Le premier
 *    `PATCH /api/maintenance-schedules/:id` n'écrivait que `isActive` : toute
 *    modification du formulaire était perdue en silence. Liste gelée, elle ne
 *    peut que rétrécir : vidée le 3 novembre 2026 (les six doublons restants
 *    ont été supprimés, comportement servi figé par contrat :
 *    `fleet-history`, `part-usage-history`, `check-all-maintenance`,
 *    `maintenance-schedules`, et `warehouse.routes.ts` pour les deux routes
 *    magasin). Toute nouvelle entrée est une régression.
 * 2. `POST /api/users` journalisait `req.body` par `console.log`, donc le mot de
 *    passe en clair. Un corps de requête ne se journalise que par
 *    `moduleLogger`, dont la configuration masque `*.password`.
 * 3. Lectures sans cloison (3 novembre 2026, #157 puis #163 puis ce lot) : une lecture GET gardée
 *    par la seule session (`authenticate`, `isAnyUser`, `authorize([... 'client' ...])`,
 *    `isWorkflowDocumentWriter`...) doit, AVANT d'envoyer la donnée, contrôler le propriétaire
 *    (`canAccessOwned`, `ownerScopeOf`) ou l'OT (`assertWorkOrderReadable`, obligatoire sur un
 *    chemin d'OT), sinon porter une garde qui exclut le client (AGENTS.md §11). Les gardes sont
 *    classées depuis `server/middleware/auth.ts` (rôles réels), commentaires retirés, en-tête
 *    coupé au premier `async` / `function` / `(req`. Liste gelée des lectures restantes : elle ne
 *    peut que rétrécir (une entrée corrigée doit en sortir). Une nouvelle lecture ouverte échoue.
 */
/**
 * Lectures encore ouvertes à tout compte connecté, à traiter une à une (dette connue, 3 novembre 2026).
 * Certaines sont masquées par un routeur de `server/api/` monté avant `registerRoutes`
 * (`/api/exports/*`, `/api/warehouse/*`, `/api/alerts*`, `/api/fuel-card/*`) ou cloisonnent en ligne
 * par un rôle lu sur l'utilisateur chargé (`/api/vehicles`, `/api/users`, `/api/work-orders/:id`) :
 * le scan statique ne le voit pas, il faut vérifier la route servie avant de la retirer d'ici.
 */
const OPEN_GET_READS_FROZEN: string[] = [
  "server/api/document-renewals.routes.ts GET /document-renewals/centers",
  "server/api/document-renewals.routes.ts GET /document-renewals/requests",
  "server/api/feature-flags.routes.ts GET /feature-flags",
  "server/api/incidents.routes.ts GET /incidents",
  "server/api/notification-settings.routes.ts GET /notifications/settings",
  "server/api/work-order-items.routes.ts GET /labor-catalog/",
  "server/routes.ts GET /api/alerts",
  "server/routes.ts GET /api/alerts/active",
  "server/routes.ts GET /api/alerts/count",
  "server/routes.ts GET /api/alerts/type/:type",
  "server/routes.ts GET /api/alerts/unread",
  "server/routes.ts GET /api/auth/me",
  "server/routes.ts GET /api/dashboard/technician-stats",
  "server/routes.ts GET /api/exports/complete",
  "server/routes.ts GET /api/exports/fuel",
  "server/routes.ts GET /api/exports/inventory",
  "server/routes.ts GET /api/exports/users",
  "server/routes.ts GET /api/exports/vehicles",
  "server/routes.ts GET /api/fault-catalog",
  "server/routes.ts GET /api/fuel-card/balance",
  "server/routes.ts GET /api/fuel-card/history",
  "server/routes.ts GET /api/fuel-card/monthly-stats",
  "server/routes.ts GET /api/fuel-card/stats-by-client",
  "server/routes.ts GET /api/onboarding/status",
  "server/routes.ts GET /api/suppliers/:id/invoices/payment",
  "server/routes.ts GET /api/suppliers/summary",
  "server/routes.ts GET /api/suppliers/top",
  "server/routes.ts GET /api/technician/my-work-orders",
  "server/routes.ts GET /api/tire-inspections",
  "server/routes.ts GET /api/tire-inspections/:id",
  "server/routes.ts GET /api/tire-inspections/recent",
  "server/routes.ts GET /api/tire-rotations",
  "server/routes.ts GET /api/tire-rotations/:id/details",
  "server/routes.ts GET /api/tires",
  "server/routes.ts GET /api/tires/:id",
  "server/routes.ts GET /api/tires/low-stock",
  "server/routes.ts GET /api/tires/statistics",
  "server/routes.ts GET /api/tires/statistics-advanced",
  "server/routes.ts GET /api/users",
  "server/routes.ts GET /api/users/:id",
  "server/routes.ts GET /api/users/technicians",
  "server/routes.ts GET /api/vehicle-tires",
  "server/routes.ts GET /api/vehicle-tires/:vehicleTireId/last-inspection",
  "server/routes.ts GET /api/vehicles",
  "server/routes.ts GET /api/vehicles/all",
  "server/routes.ts GET /api/vehicles/check/:registrationNumber",
  "server/routes.ts GET /api/warehouse/inventory-value",
  "server/routes.ts GET /api/warehouse/most-used-parts",
  "server/routes.ts GET /api/warehouse/parts-by-supplier",
  "server/routes.ts GET /api/warehouse/reorder-alerts",
  "server/routes.ts GET /api/warehouse/statistics",
  "server/routes.ts GET /api/work-orders/:id",
  "server/routes.ts GET /api/workflows/active",
  "server/routes.ts GET /api/workflows/stats",
  "server/routes.ts GET /api/workflows/vehicle-acquisition/:sessionId",
];
const KNOWN_DUPLICATE_ROUTES: string[] = [];

const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const roleConstants = roles as unknown as Record<string, readonly string[]>;

describe("hygiène des routes serveur", () => {
  it("aucune nouvelle route déclarée deux fois dans server/routes.ts", () => {
    const source = readFileSync(join(serverDir, "routes.ts"), "utf8");
    const routes = [...source.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(routes.length).toBeGreaterThan(0);
    const duplicates = [...new Set(routes.filter((route, index) => routes.indexOf(route) !== index))];
    expect(duplicates.sort()).toEqual([...KNOWN_DUPLICATE_ROUTES].sort());
  });

  it("aucun corps de requête journalisé par console.*", () => {
    const offenders = sourceFiles(serverDir).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /console\.\w+\(.*req\.body/.test(line))
        .map(({ index }) => `${path.slice(serverDir.length + 1)}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });

  it("aucune lecture GET n'est ouverte à un client sans cloison (liste gelée qui ne peut que rétrécir)", () => {
    const { offenders, seen } = scanOpenGetReads(serverDir, roleConstants);
    expect(seen.size).toBeGreaterThan(150);
    // nouvelle lecture ouverte = régression ; entrée gelée devenue saine = à retirer de la liste
    expect(offenders.filter((key) => !OPEN_GET_READS_FROZEN.includes(key))).toEqual([]);
    expect(OPEN_GET_READS_FROZEN.filter((key) => !offenders.includes(key))).toEqual([]);
  });
});

describe("garde de cloison des lectures : le scan ne se laisse pas tromper", () => {
  const kinds = classifyAuthGuards(readFileSync(join(serverDir, "middleware", "auth.ts"), "utf8"), roleConstants);
  const verdictOf = (source: string, mountPrefix = "", fileGuards: string[] = []) => {
    const [route] = extractGetRoutes("server/api/test.routes.ts", source);
    return judgeGetRoute({ ...route, mountPrefix }, kinds, fileGuards).ok;
  };

  it("classe les gardes d'auth.ts d'après leurs rôles réels", () => {
    expect(kinds.restrictive.has("isStaff")).toBe(true);
    expect(kinds.restrictive.has("isWorkshopManager")).toBe(true);
    expect(kinds.permissive.has("isAnyUser")).toBe(true);
    expect(kinds.permissive.has("isWorkflowDocumentWriter")).toBe(true);
    expect(kinds.permissive.has("authenticate")).toBe(true);
  });

  it("session seule sans contrôle : refusé", () => {
    expect(verdictOf('router.get("/x", authenticate, async (req, res) => { res.json(await read()); });')).toBe(false);
    expect(verdictOf('router.get("/x", isAnyUser, async (req, res) => { res.json(await read()); });')).toBe(false);
  });

  it("handler `async function (req, res)` : l'en-tête est coupé avant le corps", () => {
    const src = 'router.get("/x", authenticate, async function (req, res) { const ok = isStaff(req.user); authorize(["admin"]); res.json(await read()); });';
    expect(verdictOf(src)).toBe(false);
  });

  it("une garde `is*` qui laisse passer le client (isWorkflowDocumentWriter) n'est pas une cloison", () => {
    expect(verdictOf('router.get("/x", isWorkflowDocumentWriter, async (req, res) => { res.json(1); });')).toBe(false);
  });

  it("authorize avec le rôle client : refusé ; sans lui : accepté", () => {
    expect(verdictOf('router.get("/x", authorize(["client", "admin"]), async (req, res) => { res.json(1); });')).toBe(false);
    expect(verdictOf('router.get("/x", authorize(["admin", "warehouse"]), async (req, res) => { res.json(1); });')).toBe(true);
  });

  it("une garde nommée isAnyUserX n'est pas exemptée par son préfixe", () => {
    expect(verdictOf('router.get("/x", isAnyUserOrGuest, async (req, res) => { res.json(1); });')).toBe(false);
  });

  it("un commentaire qui cite le contrôle ne vaut pas contrôle", () => {
    const src = 'router.get("/work-orders/:id/x", authenticate, async (req, res) => {\n  // TODO assertWorkOrderReadable\n  /* canAccessOwned */\n  res.json(1);\n});';
    expect(verdictOf(src)).toBe(false);
  });

  it("le contrôle placé après l'envoi de la donnée ne vaut pas contrôle", () => {
    const after = 'router.get("/work-orders/:id/x", authenticate, async (req, res) => { res.json(await read()); await assertWorkOrderReadable(req.user, 1); });';
    const before = 'router.get("/work-orders/:id/x", authenticate, async (req, res) => { await assertWorkOrderReadable(req.user, 1); res.json(await read()); });';
    expect(verdictOf(after)).toBe(false);
    expect(verdictOf(before)).toBe(true);
  });

  it("une réponse d'erreur 4xx avant le contrôle n'est pas un envoi de donnée", () => {
    const src =
      'router.get("/x", isAnyUser, async (req, res) => { if (!id) return res.status(400).json({ message: "id" }); if (!(await canAccessOwned(req.user, owner))) return res.status(403).json({}); res.json(1); });';
    expect(verdictOf(src)).toBe(true);
  });

  it("route `/:id/...` d'un routeur monté sous /work-orders : assertWorkOrderReadable exigé", () => {
    const owned = 'router.get("/:id/lines", isAnyUser, async (req, res) => { await canAccessOwned(req.user, owner); res.json(1); });';
    const readable = 'router.get("/:id/lines", isAnyUser, async (req, res) => { await assertWorkOrderReadable(req.user, 1); res.json(1); });';
    expect(verdictOf(owned, "/work-orders")).toBe(false);
    expect(verdictOf(readable, "/work-orders")).toBe(true);
  });

  it("garde posée sur le routeur ou au montage : toutes ses lectures sont couvertes", () => {
    const src = 'router.get("/x", authenticate, async (req, res) => { res.json(1); });';
    expect(verdictOf(src, "", ["isStaff"])).toBe(true);
    expect(verdictOf(src, "", ["isAnyUser"])).toBe(false);
    expect(routerLevelGuards("router.use(isStaff);\nrouter.get('/a', authenticate, h);").get("router")).toEqual(["isStaff"]);
  });

  it("stripComments conserve les chaînes qui contiennent //", () => {
    expect(stripComments('const u = "http://x"; // note\nconst v = 1; /* bloc */')).toBe('const u = "http://x"; \nconst v = 1; ');
  });
});
