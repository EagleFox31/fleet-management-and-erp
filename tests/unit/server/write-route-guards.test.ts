import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_DIR, findUnguardedWriteRoutes, WRITE_ROUTE } from "../../support/write-route-scan";
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
});
