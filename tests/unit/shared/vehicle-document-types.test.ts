import { describe, expect, it } from "vitest";
import {
  VEHICLE_DOCUMENT_TYPE_ALIASES,
  VEHICLE_DOCUMENT_TYPE_SEED,
  normalizeVehicleDocumentType,
} from "../../../shared/constants/vehicle-document-types";

describe("normalizeVehicleDocumentType : table d'alias, source unique des écrivains de vehicle_documents", () => {
  it.each([
    ["insurance", "assurance"],
    ["inspection", "visite_technique"],
    ["technical_inspection", "visite_technique"],
    ["controle_technique", "visite_technique"],
    ["license", "carte_grise"],
    ["registration", "carte_grise"],
    ["registration_card", "carte_grise"],
  ])("%s devient %s", (alias, code) => {
    expect(normalizeVehicleDocumentType(alias)).toBe(code);
  });

  it("la table d'alias est exactement celle-là (aucun alias ajouté ou perdu en silence)", () => {
    expect(Object.keys(VEHICLE_DOCUMENT_TYPE_ALIASES).sort()).toEqual(
      ["controle_technique", "inspection", "insurance", "license", "registration", "registration_card", "technical_inspection"],
    );
  });

  it("tout alias pointe vers un code de la graine", () => {
    const seeded = new Set<string>(VEHICLE_DOCUMENT_TYPE_SEED.map((t) => t.code));
    for (const target of Object.values(VEHICLE_DOCUMENT_TYPE_ALIASES)) expect(seeded.has(target), target).toBe(true);
  });

  it("casse et espaces ignorés", () => {
    expect(normalizeVehicleDocumentType("  Insurance ")).toBe("assurance");
    expect(normalizeVehicleDocumentType("CARTE_GRISE")).toBe("carte_grise");
  });

  it("un code du référentiel, connu ou créé à chaud, passe inchangé : le référentiel tranche", () => {
    for (const { code } of VEHICLE_DOCUMENT_TYPE_SEED) expect(normalizeVehicleDocumentType(code)).toBe(code);
    expect(normalizeVehicleDocumentType("permis_special")).toBe("permis_special");
  });

  it("vide, null ou undefined donne une chaîne vide, jamais 'undefined'", () => {
    expect(normalizeVehicleDocumentType(undefined)).toBe("");
    expect(normalizeVehicleDocumentType(null)).toBe("");
    expect(normalizeVehicleDocumentType("   ")).toBe("");
  });

  it("un nom de propriété d'objet n'est pas pris pour un alias", () => {
    expect(normalizeVehicleDocumentType("constructor")).toBe("constructor");
    expect(normalizeVehicleDocumentType("__proto__")).toBe("__proto__");
  });
});
