import path from "path";
import { describe, expect, it } from "vitest";
import { isVehicleIdSegment, vehicleDocumentDirectory } from "../../../server/middleware/upload";

/** #130 : le dossier multer d'un document véhicule ne sort jamais de uploads/documents. */
describe("vehicleDocumentDirectory", () => {
  it("garde la forme relative stockée en base pour un identifiant numérique", () => {
    expect(vehicleDocumentDirectory("42")).toBe(path.join("uploads", "documents", "vehicle-42"));
  });

  it.each(["1../../../x", String.raw`1..\..\x`, "12abc", "", "-1", "1.5", " 1", "1/2", "..", "1".repeat(19)])(
    "refuse %j",
    (value) => {
      expect(isVehicleIdSegment(value)).toBe(false);
      expect(vehicleDocumentDirectory(value)).toBeNull();
    },
  );

  it("refuse une valeur qui n'est pas une chaîne", () => {
    expect(vehicleDocumentDirectory(undefined)).toBeNull();
    expect(vehicleDocumentDirectory(42)).toBeNull();
  });
});
