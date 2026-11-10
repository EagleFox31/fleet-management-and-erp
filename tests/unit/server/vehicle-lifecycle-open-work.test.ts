import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VEHICLE_ACTIVITY_SOURCES } from "../../../server/services/vehicle-lifecycle-sources";

/**
 * `openWork` (suppression douce) doit chercher les affectations par chaque colonne que
 * `VEHICLE_ACTIVITY_SOURCES` classe pour `assignments` : oublier `trailer_id` laissait supprimer
 * une remorque attelée (docs/analysis/LESSONS_LEARNED.md, lot remorque).
 */
describe("openWork : colonnes d'affectation", () => {
  const src = readFileSync("server/services/vehicle-lifecycle-service.ts", "utf8");
  const start = src.indexOf("async function openWork");
  const body = src.slice(start, src.indexOf("\nexport async function deleteVehicle"));

  it("le corps de openWork est trouvé", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body.length).toBeGreaterThan(100);
  });

  const columns = VEHICLE_ACTIVITY_SOURCES.filter((s) => s.table === "assignments").map((s) => s.column);
  it("la source classe au moins vehicle_id et trailer_id", () => {
    expect(columns).toEqual(expect.arrayContaining(["vehicle_id", "trailer_id"]));
  });
  for (const column of columns) {
    it(`openWork couvre assignments.${column}`, () => {
      expect(body.includes(`${column} = `)).toBe(true);
    });
  }
});
