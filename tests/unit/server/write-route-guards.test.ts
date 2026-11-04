import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_DIR,
  countAnyWriteCalls,
  countAnyWriteCallsIn,
  findUnguardedWriteRoutes,
  findWriteRoutes,
  findWriteRoutesIn,
  WRITE_ROUTE,
} from "../../support/write-route-scan";
import { FROZEN_UNGUARDED_WRITE_ROUTES } from "./write-route-guards.frozen";

/**
 * Garde au montage trop large (LESSONS_LEARNED, 3e occurrence le 3 novembre 2026) :
 * un routeur monté derrière `isStaff` laisse toute route d'écriture ouverte à tout le personnel.
 * Toute route d'écriture de `server/api/` déclare donc ses rôles sur la route elle-même
 * (`authorize(...)` ou un middleware `isXxx`). Les routes existantes sans garde sont gelées :
 * la liste ne peut que diminuer.
 *
 * Une route qui décide le rôle dans son corps (cloison chauffeur, rôle lu en base) reste
 * dans la liste : la retirer exige une garde explicite sur la déclaration.
 */

describe("routes d'écriture de server/api : rôles déclarés sur la route", () => {
  const found = findUnguardedWriteRoutes();

  it("le scanner trouve des routes (sinon il est aveugle)", () => {
    const source = fs.readFileSync(path.join(API_DIR, "missions.routes.ts"), "utf8");
    expect(source).toMatch(WRITE_ROUTE);
  });

  it("aucune nouvelle route d'écriture sans garde de rôle", () => {
    const added = found.filter((route) => !FROZEN_UNGUARDED_WRITE_ROUTES.includes(route));
    expect(added, "Déclarer authorize([...ROLES]) sur la route, voir AGENTS.md §11").toEqual([]);
  });

  it("la liste gelée ne garde que des routes encore sans garde (elle ne fait que diminuer)", () => {
    const stale = FROZEN_UNGUARDED_WRITE_ROUTES.filter((route) => !found.includes(route));
    expect(stale, "Retirer ces lignes de write-route-guards.frozen.ts").toEqual([]);
  });

  it("le scanner voit autant de routes qu'un compte grossier des .post/.put/.patch/.delete", () => {
    // Un écart signale un receveur ou une forme de déclaration que WRITE_ROUTE ne reconnaît pas.
    expect(findWriteRoutes().length).toBe(countAnyWriteCalls());
  });
});

describe("scanner des routes d'écriture : faux verts connus", () => {
  const scan = (source: string) => findWriteRoutesIn("x.routes.ts", source);

  it("isAnyUser et authenticate ne sont pas des gardes de rôle", () => {
    expect(scan(`router.post("/a", isAnyUser, async (req, res) => {});`)).toEqual([
      { id: "x.routes.ts POST /a", guarded: false },
    ]);
    expect(scan(`router.patch("/b", authenticate, handler);`)[0].guarded).toBe(false);
    expect(scan(`router.delete("/c", isAnyUser, isStaff, async (req, res) => {});`)[0].guarded).toBe(true);
  });

  it("un receveur xxxRoutes est scanné", () => {
    expect(scan(`laborCatalogWriteRoutes.patch("/:id", async (req, res) => {});`)).toEqual([
      { id: "x.routes.ts PATCH /:id (laborCatalogWriteRoutes)", guarded: false },
    ]);
  });

  it("une déclaration sur plusieurs lignes est lue jusqu'au handler", () => {
    const multi = `router.put(\n  "/d",\n  authorize(["admin"]),\n  async (req, res) => {},\n);`;
    expect(scan(multi)).toEqual([{ id: "x.routes.ts PUT /d", guarded: true }]);
    const late = `router.put(\n  "/e",\n  async (req, res) => { isStaff; },\n);`;
    expect(scan(late)[0].guarded).toBe(false);
  });

  it("le compte grossier ignore les requêtes db/tx/trx, même chaînées sur une autre ligne", () => {
    // Faux positifs : écritures Drizzle, receveur collé ou séparé du point.
    const drizzle = `await db.delete(t);
await tx
  .delete(t)
  .where(x);
await trx .delete(t);
this.db.delete(t);`;
    expect(countAnyWriteCallsIn(drizzle)).toBe(0);
    // Vrais positifs : routes, y compris chaînées, et identifiants qui finissent par tx.
    const routes = `router.post("/a", h);
router
  .delete("/b", h);
ctx.patch("/c", h);
adminRouter.put("/d", h);`;
    expect(countAnyWriteCallsIn(routes)).toBe(4);
    // Receveur chaîné ou non reconnu : WRITE_ROUTE ne le voit pas, l'écart avec le compte grossier le signale.
    expect(scan(routes).length).toBe(2);
  });
});
