import { describe, expect, it } from "vitest";
import { vehicleIdsWithRegisteredTiresIfKnown, vehicleTiresRegistration } from "@/lib/vehicle-tires-status";

/**
 * Liste et fiche véhicule : une lecture des pneus en échec n'est pas « aucun pneu ».
 * Constat du 7 novembre 2026 (#592) : les lectures pneus renvoient 500 au lieu de [],
 * et les écrans affichaient « Pneus non renseignés » sur tous les véhicules
 * (et l'invite de montage sur la fiche).
 */
describe("fiche véhicule : pneus enregistrés", () => {
  it("liste lue avec un montage actif : enregistrés", () => {
    expect(vehicleTiresRegistration([{ status: "active", position: "AVG" }])).toBe(true);
  });

  it("liste lue, vide : non enregistrés", () => {
    expect(vehicleTiresRegistration([])).toBe(false);
  });

  it("liste jamais lue (échec sans cache ou chargement) : inconnu", () => {
    expect(vehicleTiresRegistration(undefined)).toBeNull();
  });

  it("réponse qui n'est pas une liste : inconnu", () => {
    expect(vehicleTiresRegistration({ message: "x" } as never)).toBeNull();
  });
});

describe("liste des véhicules : véhicules avec pneus", () => {
  it("liste lue : ensemble des véhicules équipés", () => {
    const ids = vehicleIdsWithRegisteredTiresIfKnown([{ vehicleId: 3, status: "active" }]);
    expect(ids && [...ids]).toEqual([3]);
  });

  it("liste jamais lue : inconnu, aucun badge à poser", () => {
    expect(vehicleIdsWithRegisteredTiresIfKnown(undefined)).toBeNull();
  });
});
