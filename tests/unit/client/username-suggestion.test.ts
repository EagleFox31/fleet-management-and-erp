import { describe, it, expect } from "vitest";
import { suggestUsernameFromFullName } from "@/lib/username-suggestion";

describe("suggestUsernameFromFullName", () => {
  it("retourne une chaîne vide pour un nom vide", () => {
    expect(suggestUsernameFromFullName("")).toBe("");
    expect(suggestUsernameFromFullName("   ")).toBe("");
  });

  it("propose prénom.nom pour un nom complet", () => {
    expect(suggestUsernameFromFullName("Jean Dupont")).toBe("jean.dupont");
  });

  it("normalise les accents et la casse", () => {
    expect(suggestUsernameFromFullName("Élodie Müller")).toBe("elodie.muller");
  });

  it("retourne un seul segment pour un prénom seul", () => {
    expect(suggestUsernameFromFullName("Jean")).toBe("jean");
  });

  it("conserve les tirets dans les prénoms composés", () => {
    expect(suggestUsernameFromFullName("Jean-Pierre Martin")).toBe("jean-pierre.martin");
  });

  it("ignore les caractères spéciaux", () => {
    expect(suggestUsernameFromFullName("Marie O'Brien")).toBe("marie.obrien");
  });
});
