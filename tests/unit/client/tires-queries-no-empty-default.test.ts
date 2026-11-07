import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde sur le code source (#593) : une lecture pneus en échec n'est pas une absence de données.
 * Deuxième occurrence du défaut après docs/journal/widgets-silent-errors.md : `data: x = []`
 * sur une requête pneus fait passer un 500 pour « aucun pneu » (faux badge, coût d'OT
 * sous-évalué). Les tests des helpers ne suffisent pas : il faut que les pages s'en servent.
 */
const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf8");

const TIRE_ENDPOINT = /\/api\/(?:vehicle-tires|vehicles\/\$\{[^}]+\}\/tires|work-orders\/\$\{[^}]+\}\/tire-rotations)/;

/** Requêtes pneus dont la déstructuration donne une valeur par défaut `= []`. */
export function tireQueriesWithEmptyDefault(src: string): string[] {
  const segments = src.split(/useQuery\s*</);
  const offenders: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const head = segments[i].slice(0, 400);
    const key = head.match(TIRE_ENDPOINT);
    if (!key) continue;
    const before = segments[i - 1];
    const destructure = before.slice(before.lastIndexOf("const {"));
    if (/=\s*\[\s*\]/.test(destructure)) offenders.push(key[0]);
  }
  return offenders;
}

const FILES = {
  workOrder: "client/src/pages/maintenance/work-orders/[id].tsx",
  vehicleTable: "client/src/components/vehicles/vehicle-table.tsx",
  vehicleDetail: "client/src/pages/vehicles/[id].tsx",
};

describe("requêtes pneus : jamais `= []` par défaut", () => {
  it("le garde détecte la régression (témoin)", () => {
    const regressed = "const { data: tireRotations = [] } = useQuery<any[]>({\n  queryKey: [`/api/work-orders/${id}/tire-rotations`],\n});";
    expect(tireQueriesWithEmptyDefault(regressed)).toEqual(["/api/work-orders/${id}/tire-rotations"]);
  });

  it.each(Object.entries(FILES))("%s : aucune requête pneus avec `= []`", (_name, file) => {
    const src = read(file);
    expect(src).toMatch(TIRE_ENDPOINT);
    expect(tireQueriesWithEmptyDefault(src)).toEqual([]);
  });

  it("fiche OT : coût via workOrderDisplayCost et vue via listQueryView, pas computeWorkOrderCost direct", () => {
    const src = read(FILES.workOrder);
    expect(src).toMatch(/listQueryView<[^>]*>\(\{\s*data:\s*tireRotationsData/);
    expect(src.match(/workOrderDisplayCost\(/g)?.length).toBe(2);
    expect(src).not.toMatch(/computeWorkOrderCost\(/);
    expect(src).not.toMatch(/isError:\s*true/);
  });

  it("liste des véhicules : badge seulement si les pneus ont été lus", () => {
    const src = read(FILES.vehicleTable);
    expect(src).toMatch(/vehicleIdsWithRegisteredTiresIfKnown\(allVehicleTires\)/);
    expect(src).toMatch(/vehicleIdsWithTires && !vehicleIdsWithTires\.has\(/);
  });

  it("fiche véhicule : badge, bandeau et invite seulement si l'état est connu", () => {
    const src = read(FILES.vehicleDetail);
    expect(src).toMatch(/vehicleTiresRegistration\(vehicleMountedTires\)/);
    expect(src).not.toMatch(/!tiresRegistered\b/);
    expect(src.match(/tiresRegistered === false/g)?.length).toBe(3);
  });
});
