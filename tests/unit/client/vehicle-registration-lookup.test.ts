import { describe, expect, it } from "vitest";
import { VEHICLES_PAGE_SIZE } from "../../../client/src/lib/fetch-all-pages";
import {
  findVehicleByRegistration,
  REGISTRATION_LOOKUP_LIMIT,
} from "../../../client/src/lib/vehicle-registration-lookup";

const fleet = [
  { id: 1, registrationNumber: "AB-123-CD" },
  { id: 2, registrationNumber: "AB-123-CDE" },
  { id: 3, registrationNumber: "LT-456-ZZ" },
];

describe("recherche d'un véhicule par immatriculation (page /vehicles/immatriculation)", () => {
  it("trouve la correspondance exacte, pas la plus longue qui la contient", () => {
    expect(findVehicleByRegistration(fleet, "AB-123-CD")?.id).toBe(1);
  });

  it("ignore la casse et les espaces de bord de l'URL", () => {
    expect(findVehicleByRegistration(fleet, "lt-456-zz")?.id).toBe(3);
    expect(findVehicleByRegistration(fleet, " LT-456-ZZ ")?.id).toBe(3);
  });

  it("sans correspondance exacte ou sans liste : undefined", () => {
    expect(findVehicleByRegistration(fleet, "AB-123")).toBeUndefined();
    expect(findVehicleByRegistration(undefined, "AB-123-CD")).toBeUndefined();
  });

  it("lit une page complète, pas 50 lignes", () => {
    expect(REGISTRATION_LOOKUP_LIMIT).toBe(VEHICLES_PAGE_SIZE);
    expect(REGISTRATION_LOOKUP_LIMIT).toBeGreaterThan(50);
  });
});
