import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou issu d'une récidive (« routes sœurs ouvertes », docs/analysis/LESSONS_LEARNED.md) : la liste et la
 * fiche mission ont été fermées au technicien, mais `launch-readiness`, `document-renewal-requests`, les listes
 * `/api/operations/missions*` puis `/api/drivers/me` servaient encore des missions à tout le personnel, parce
 * qu'elles ne portaient que le garde du montage (`isStaff`).
 *
 * Toute lecture (`GET`) des routeurs de missions, d'exploitation et de fiches chauffeur déclare donc son propre
 * garde de rôle, en plus du montage : `authorize([...])` ou un middleware nommé autre que `authenticate`.
 * Le garde choisi reste à relire ; ce test interdit seulement d'en oublier un.
 */
const ROUTERS = [
  "missions.routes.ts",
  "mission-pod.routes.ts",
  "mission-track.routes.ts",
  "mission-price.routes.ts",
  "operations.routes.ts",
  "drivers.routes.ts",
  "drivers-management.routes.ts",
];

const apiDir = fileURLToPath(new URL("../../../server/api", import.meta.url));

/** Middlewares déclarés avant le handler de chaque `router.get(...)`, dans l'ordre du fichier. */
export function getRouteGuards(source: string): { path: string; middlewares: string[] }[] {
  const routes: { path: string; middlewares: string[] }[] = [];
  for (const m of source.matchAll(/\brouter\.get\(\s*"([^"]+)"\s*,([\s\S]*?)(?:\basync\b|\(\s*req\b|\breq\s*=>)/g)) {
    const middlewares = m[2]
      .split(/,(?![^([]*[)\]])/)
      .map((part) => part.trim())
      .filter(Boolean);
    routes.push({ path: m[1], middlewares });
  }
  return routes;
}

export const hasRoleGuard = (middlewares: string[]) => middlewares.some((mw) => mw !== "authenticate");

describe("lectures de missions et de fiches chauffeur : garde de rôle explicite", () => {
  it("le parseur reconnaît un garde et refuse authenticate seul", () => {
    const routes = getRouteGuards(
      'router.get("/a", authenticate, async (req, res) => {});\nrouter.get("/b", authenticate, authorize([...X, "driver"]), async (req, res) => {});\nrouter.get("/c", isStaffReader, (req, res) => {});\nrouter.get("/d", async (req, res) => {});',
    );
    expect(routes.map((r) => [r.path, hasRoleGuard(r.middlewares)])).toEqual([
      ["/a", false],
      ["/b", true],
      ["/c", true],
      ["/d", false],
    ]);
  });

  it.each(ROUTERS)("%s : chaque GET déclare son garde de rôle", (file) => {
    const source = readFileSync(join(apiDir, file), "utf8");
    const routes = getRouteGuards(source);
    // Chaque déclaration est lue : aucune n'échappe au parseur par une mise en forme inattendue.
    expect(routes.length, `${file} : déclarations lues`).toBe(source.match(/\brouter\.get\s*\(/g)?.length ?? 0);
    expect(routes.filter((r) => !hasRoleGuard(r.middlewares)).map((r) => r.path), file).toEqual([]);
  });
});
