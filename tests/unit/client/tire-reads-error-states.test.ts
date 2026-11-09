import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../client/src/lib/api-error";
import { queryView, readyData, type QueryView } from "../../../client/src/lib/query-view";
import { mountBlock, occupiedPositionsView } from "../../../client/src/lib/tire-mount-readiness";

/**
 * Lectures pneus en échec (#592) : depuis que le serveur répond 500 au lieu de `[]`, un écran qui
 * retombe sur `= []` ou sur `?? 0` affiche « Aucun pneu sous son seuil », « 0 référence » ou
 * « toutes les positions libres » comme de vraies valeurs. Les écrans passent par `queryView`.
 */
const failure = new ApiError(500, "Une erreur technique est survenue. Référence : r-1", { requestId: "r-1" });

describe("queryView : jamais un vide pendant une erreur", () => {
  it("échec sans données : erreur, pas de données vides", () => {
    expect(queryView({ data: undefined, error: failure, isFetching: false })).toEqual({ kind: "error", error: failure, isRetrying: false });
  });

  it("nouvel essai en cours : « Réessayer » désactivé", () => {
    expect(queryView({ data: undefined, error: failure, isFetching: true })).toMatchObject({ kind: "error", isRetrying: true });
  });

  it("relance en échec avec des données en cache : les données restent (règle de #591)", () => {
    expect(queryView({ data: [{ id: 1 }], error: failure, isFetching: false })).toEqual({ kind: "ready", data: [{ id: 1 }] });
  });

  it("une liste réellement vide reste un vide", () => {
    expect(queryView({ data: [], error: null, isFetching: false })).toEqual({ kind: "ready", data: [] });
  });

  it("premier chargement ou requête désactivée : chargement", () => {
    expect(queryView({ data: undefined, error: null, isFetching: true })).toEqual({ kind: "loading" });
    expect(queryView({ data: undefined, error: null, isFetching: false })).toEqual({ kind: "loading" });
  });

  it("readyData ne fournit le repli que hors état prêt", () => {
    expect(readyData(queryView({ data: [1], error: null, isFetching: false }), [])).toEqual([1]);
    expect(readyData(queryView<number[]>({ data: undefined, error: failure, isFetching: false }), null)).toBeNull();
  });
});

describe("montage d'un pneu : positions occupées inconnues = montage bloqué", () => {
  const rows = [
    { vehicleId: 7, position: "front_left", status: "active" },
    { vehicleId: 7, position: "front_right", status: "removed" },
    { vehicleId: 8, position: "rear_left", status: "active" },
  ];
  const ready = <T,>(data: T): QueryView<T> => ({ kind: "ready", data });
  const errorView: QueryView<never> = { kind: "error", error: failure, isRetrying: false };

  it("positions occupées du véhicule choisi, montages actifs seulement", () => {
    expect(occupiedPositionsView({ locked: false, lockedOccupied: [], vehicleId: 7, vehicleTires: ready(rows) })).toEqual(ready(["front_left"]));
  });

  it("vehicle-tires en échec : positions inconnues, pas « toutes libres »", () => {
    expect(occupiedPositionsView({ locked: false, lockedOccupied: [], vehicleId: 7, vehicleTires: errorView }).kind).toBe("error");
    expect(occupiedPositionsView({ locked: false, lockedOccupied: [], vehicleId: 7, vehicleTires: { kind: "loading" } }).kind).toBe("loading");
  });

  it("véhicule imposé : l'appelant fournit les positions", () => {
    expect(occupiedPositionsView({ locked: true, lockedOccupied: ["rear_left"], vehicleId: 7, vehicleTires: errorView })).toEqual(ready(["rear_left"]));
  });

  const base = {
    isPending: false,
    vehicleId: 7,
    position: "front_right",
    tireId: "3",
    occupied: ready(["front_left"]),
    freePositionsCount: 5,
    catalog: ready({ tires: [] }) as QueryView<unknown>,
    availableTiresCount: 2,
  };

  it("tout est connu et choisi : montage possible", () => {
    expect(mountBlock(base)).toBeNull();
  });

  it("positions en erreur ou en chargement : bloqué, même avec une position déjà choisie", () => {
    expect(mountBlock({ ...base, occupied: errorView })).toBe("positions-unknown");
    expect(mountBlock({ ...base, occupied: { kind: "loading" } })).toBe("positions-unknown");
  });

  it("catalogue en erreur : bloqué, distinct de « aucun pneu en stock »", () => {
    expect(mountBlock({ ...base, catalog: errorView })).toBe("catalog-unknown");
    expect(mountBlock({ ...base, availableTiresCount: 0 })).toBe("no-tire-in-stock");
  });

  it("autres conditions inchangées", () => {
    expect(mountBlock({ ...base, isPending: true })).toBe("pending");
    expect(mountBlock({ ...base, vehicleId: 0 })).toBe("no-vehicle");
    expect(mountBlock({ ...base, freePositionsCount: 0 })).toBe("no-free-position");
    expect(mountBlock({ ...base, position: "" })).toBe("no-position");
    expect(mountBlock({ ...base, tireId: "" })).toBe("no-tire");
  });
});

describe("écrans pneus branchés sur queryView", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

  it("tableau de bord magasin : statistiques et sous-seuil sans repli silencieux", () => {
    const src = read("client/src/pages/warehouse/dashboard.tsx");
    expect(src).not.toMatch(/data:\s*lowStockTires\s*=\s*\[\]/);
    expect(src).not.toMatch(/tireStats\?\.\w+\s*\?\?\s*0/);
    expect(src).toMatch(/queryView\(tireStatsQuery\)/);
    expect(src).toMatch(/queryView\(lowStockTiresQuery\)/);
    expect(src).toContain("<InlineQueryError");
  });

  it("inventaire pneus : queryFn par défaut et état d'erreur pour montés, inspections, rotations", () => {
    const src = read("client/src/pages/inventory/tires/index.tsx");
    expect(src).not.toMatch(/Failed to fetch (vehicle tires|inspections|rotations)/);
    for (const query of ["vehicleTiresQuery", "inspectionsQuery", "rotationsQuery"]) {
      expect(src).toMatch(new RegExp(`queryView\\(${query}\\)`));
    }
    expect(src).not.toMatch(/rotations \|\| \[\]/);
  });

  it("dialogue de montage : positions et catalogue sans repli silencieux", () => {
    const src = read("client/src/components/vehicles/vehicle-tire-mount-dialog.tsx");
    expect(src).not.toMatch(/data:\s*allVehicleTires\s*=\s*\[\]/);
    expect(src).toMatch(/mountBlock\(/);
    expect(src).toMatch(/occupiedPositionsView\(/);
    expect(src).toContain("<InlineQueryError");
  });

  it("dialogue de montage : sélecteur de véhicules par la queryFn par défaut, erreur distincte d'une flotte vide", () => {
    const src = read("client/src/components/vehicles/vehicle-tire-mount-dialog.tsx");
    expect(src).not.toMatch(/data:\s*vehiclesList\s*=\s*\[\]/);
    expect(src).not.toMatch(/fetch\(["'`]\/api\/vehicles/);
    expect(src).toMatch(/queryView\(vehiclesQuery\)/);
    expect(src).toContain('data-testid="mount-vehicles-error"');
  });

  it("formulaire d'inspection : le Select des pneus montés signale l'échec au lieu de rester vide", () => {
    const src = read("client/src/pages/inventory/tires/index.tsx");
    const select = src.slice(src.indexOf('name="vehicleTireId"'), src.indexOf("Sélectionnez le pneu monté à inspecter"));
    expect(select).toMatch(/disabled=\{vehicleTiresView\.kind !== "ready"\}/);
    expect(select).toContain('data-testid="inspection-mounted-tires-error"');
  });
});
