import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "../../../shared/contracts/common";
import {
  asVehicleRef,
  readBodyPath,
  RETIRED_VEHICLE_WRITE_ROUTES,
  routeParts,
} from "../../../server/lib/retired-vehicle-write-routes";
import { routeSignature, scanWriteRoutes } from "../../support/route-guard-scan";

/**
 * L3 : toute écriture qui porte un véhicule est refusée sur véhicule retiré (409). Une route d'écriture
 * dont la déclaration mentionne un véhicule doit figurer à `RETIRED_VEHICLE_WRITE_ROUTES` (garde de
 * montage), appeler `assertVehicleWritable(` dans sa poignée (corps multipart), ou être ci-dessous avec
 * sa raison. Cliquet : la liste ne fait que rétrécir, une entrée devenue couverte la fait échouer.
 * Limite : seuls les routeurs montés dans `server/api/index.ts` et `routes.ts` sont vus, et une route
 * qui n'atteint le véhicule que par un OT (`workOrderId` seul), ou qui passe le corps entier à un schéma
 * Zod sans nommer `vehicleId`, n'est pas détectée. D'où le plancher de la table : la retirer d'une
 * entrée exige de baisser `TABLE_FLOOR`, donc une revue.
 */
const NOT_GUARDED: Record<string, string> = {
  "POST /api/missions": "garde en ligne historique, 400 (vehicle-soft-delete.contract.test.ts)",
  "PATCH /api/missions/:p": "garde en ligne historique, 400 (vehicle-soft-delete.contract.test.ts)",
  "POST /api/missions/:p/assignments": "garde en ligne historique, 400 (vehicle-soft-delete.contract.test.ts)",
  "PUT /api/missions/:p/status": "plusieurs véhicules par affectation ; retrait refusé tant qu'une mission est ouverte",
  "POST /api/missions/:p/document-renewal-requests": "plusieurs véhicules par affectation ; retrait refusé tant qu'une mission est ouverte",
  "PATCH /api/fuel-card/anomalies/:p": "traitement d'une anomalie (clé d'anomalie), aucune saisie sur le véhicule",
  "DELETE /api/work-orders/bulk-pending-unassigned": "purge administrative en masse, pas une saisie sur un véhicule",
  "POST /api/vehicles/activate-from-workflow": "crée le véhicule, ne vise pas un véhicule existant",
};

// Égal à la taille de la table : en ajouter une entrée oblige à relever ce nombre, sinon le cliquet
// se périmerait et laisserait retirer une entrée sans revue.
const TABLE_FLOOR = 44;
const VEHICLE_MARKER = /\b(vehicleId|vehicle_id|vehicleTireId|fuelRecordId)\b/;
const serverDir = fileURLToPath(new URL("../../../server", import.meta.url));
const signatureOf = (route: string) => {
  const [method, path] = route.split(" ");
  return routeSignature(method, path);
};

describe("écritures sur véhicule retiré : couverture de la garde", () => {
  const routes = scanWriteRoutes(serverDir);
  const scanned = new Set(routes.map((r) => r.signature));
  const table = new Set(RETIRED_VEHICLE_WRITE_ROUTES.map((r) => signatureOf(r.route)));
  const uncovered = [
    ...new Set(
      routes
        .filter((r) => VEHICLE_MARKER.test(r.handler) && !table.has(r.signature) && !r.handler.includes("assertVehicleWritable("))
        .map((r) => r.signature),
    ),
  ].sort();

  it("le balayage voit les écritures de routes.ts et de server/api", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((r) => r.file === "server/routes.ts")).toBe(true);
    expect(routes.some((r) => r.file.startsWith("server/api/"))).toBe(true);
  });

  it("toute écriture qui porte un véhicule est gardée ou justifiée", () => {
    expect(uncovered.filter((s) => !(s in NOT_GUARDED))).toEqual([]);
  });

  it("cliquet : la liste des exceptions ne contient que des routes encore non gardées", () => {
    expect(Object.keys(NOT_GUARDED).filter((s) => !uncovered.includes(s))).toEqual([]);
  });

  it("chaque entrée de la table désigne une route déclarée, sans doublon", () => {
    expect([...table].filter((s) => !scanned.has(s))).toEqual([]);
    expect(table.size).toBe(RETIRED_VEHICLE_WRITE_ROUTES.length);
  });

  it("cliquet : la table ne rétrécit pas (plancher TABLE_FLOOR)", () => {
    expect(RETIRED_VEHICLE_WRITE_ROUTES.length, "taille de la table changée : ajuster TABLE_FLOOR après revue").toBe(TABLE_FLOOR);
  });

  it("le démontage de pneus reste hors table", () => {
    expect(table.has("PATCH /api/vehicle-tires/:p/remove")).toBe(false);
  });
});

describe("table : lecture du chemin et du corps", () => {
  it("routeParts : méthode Express et chemin relatif à apiRouter, entrée illisible refusée", () => {
    expect(routeParts("PATCH /api/vehicle-tires/:id")).toEqual({ method: "patch", path: "/vehicle-tires/:id" });
    expect(() => routeParts("GET /api/vehicles/:id")).toThrow();
    expect(() => routeParts("POST /vehicles")).toThrow();
    for (const entry of RETIRED_VEHICLE_WRITE_ROUTES) expect(() => routeParts(entry.route), entry.route).not.toThrow();
  });

  it("asVehicleRef : lit au moins ce que les routes convertissent, borné à la colonne integer", () => {
    for (const [value, expected] of [[7, 7], ["42", 42], [" 7", 7], ["7.0", 7], ["+7", 7], [[7], 7], ["1e3", 1000], [MAX_DB_INTEGER_ID, MAX_DB_INTEGER_ID]] as const) {
      expect(asVehicleRef(value), JSON.stringify(value)).toBe(expected);
    }
    for (const bad of [0, -1, 1.5, "", "  ", "7a", null, undefined, {}, [], [1, 2], MAX_DB_INTEGER_ID + 1, "99999999999999999999", Number.NaN]) {
      expect(asVehicleRef(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("asVehicleRef suit z.coerce.number des routes : toute valeur qu'elles acceptent est lue", () => {
    const coerce = z.coerce.number().int().positive().max(MAX_DB_INTEGER_ID);
    for (const value of [7, "7", " 7 ", "+7", "7.0", "0x7", [7], "1e2", true]) {
      const parsed = coerce.safeParse(value);
      if (parsed.success) expect(asVehicleRef(value), JSON.stringify(value)).toBe(parsed.data);
    }
  });

  it("readBodyPath : chemin pointé, absent si un maillon manque", () => {
    expect(readBodyPath({ rotation: { vehicleId: 3 } }, "rotation.vehicleId")).toBe(3);
    expect(readBodyPath({ vehicleId: 4 }, "vehicleId")).toBe(4);
    expect(readBodyPath({ rotation: null }, "rotation.vehicleId")).toBeUndefined();
    expect(readBodyPath(undefined, "vehicleId")).toBeUndefined();
  });
});
