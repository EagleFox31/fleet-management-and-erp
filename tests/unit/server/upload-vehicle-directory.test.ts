import path from "path";
import { describe, expect, it } from "vitest";
import { isVehicleIdSegment, vehicleDocumentDirectory } from "../../../server/middleware/upload";
import { isInsideDirectory } from "../../../server/lib/uploaded-file";

/** #130 : le dossier multer d'un document véhicule ne sort jamais de uploads/documents. */
describe("vehicleDocumentDirectory", () => {
  it("garde la forme relative stockée en base pour un identifiant numérique", () => {
    expect(vehicleDocumentDirectory("42")).toBe(path.join("uploads", "documents", "vehicle-42"));
  });

  it.each(["1../../../x", String.raw`1..\..\x`, "12abc", "", "-1", "1.5", " 1", "1/2", "..", "1".repeat(19), "007", "0", "2147483648", "99999999999"])(
    "refuse %j",
    (value) => {
      expect(isVehicleIdSegment(value)).toBe(false);
      expect(vehicleDocumentDirectory(value)).toBeNull();
    },
  );

  it("accepte la borne de l'int Postgres", () => {
    expect(isVehicleIdSegment("2147483647")).toBe(true);
    expect(isVehicleIdSegment("1")).toBe(true);
  });

  it("refuse une valeur qui n'est pas une chaîne", () => {
    expect(vehicleDocumentDirectory(undefined)).toBeNull();
    expect(vehicleDocumentDirectory(42)).toBeNull();
  });
});

describe("isInsideDirectory", () => {
  it("compare des chemins résolus, pas des préfixes de chaîne", () => {
    expect(isInsideDirectory("uploads/documents", "uploads/documents/vehicle-1")).toBe(true);
    expect(isInsideDirectory("uploads/documents", "uploads/documents-x/vehicle-1")).toBe(false);
    expect(isInsideDirectory("uploads/documents", "uploads/documents")).toBe(false);
    expect(isInsideDirectory("uploads/documents", "uploads/documents/vehicle-1/../../x")).toBe(false);
    expect(isInsideDirectory("uploads/documents", path.resolve("/elsewhere"))).toBe(false);
  });
});
