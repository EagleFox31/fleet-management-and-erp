import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `GET /api/maintenance-schedules` répond 500 quand la lecture échoue (elle renvoyait `[]`).
 * Chaque écran qui l'affiche doit dire « indisponible » au lieu d'une liste vide ou d'un 0,
 * sans jamais montrer `error.message`. Le rendu réel de `preventive.tsx` est prouvé par
 * `maintenance-schedules-render-error.test.ts` ; ici, le garde-fou sur les autres écrans.
 */
const read = (path: string) => readFileSync(path, "utf8");

describe("planning de maintenance : états d'erreur des écrans", () => {
  it.each([
    "client/src/pages/maintenance/gmao-dashboard.tsx",
    "client/src/pages/technician/fleet-status.tsx",
    "client/src/pages/technician/vehicles.tsx",
  ])("%s affiche InlineQueryError sur échec du planning", (path) => {
    const src = read(path);
    expect(src).toMatch(/<InlineQueryError[\s\S]{0,200}Le planning de maintenance est momentanément indisponible\./);
  });

  it("gmao-dashboard : « En retard » lit Indisponible, pas 0", () => {
    const src = read("client/src/pages/maintenance/gmao-dashboard.tsx");
    expect(src).toContain('value={schedulesFailed ? "Indisponible" : stats.overdueSchedules}');
  });

  it("technician/vehicles : le compteur d'actives lit Indisponible", () => {
    expect(read("client/src/pages/technician/vehicles.tsx")).toMatch(/maintenanceError \? "Indisponible"/);
  });

  it.each(["client/src/pages/maintenance-planner.tsx", "client/src/pages/maintenance-simple.tsx"])(
    "%s n'affiche jamais error.message",
    (path) => {
      const src = read(path);
      expect(src).not.toMatch(/\(error as Error\)\.message|error\.message/);
      expect(src).toContain('userMessageOf(error, "Le planning de maintenance est momentanément indisponible.")');
    },
  );
});
