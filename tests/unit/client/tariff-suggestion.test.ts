import { describe, expect, it } from "vitest";
import { canSetMissionPrice } from "../../../shared/constants/roles";
import {
  cityOf,
  parseAgreedPrice,
  suggestedMissionAmount,
  suggestionAttempts,
} from "../../../client/src/lib/tariff-suggestion";

const input = { clientId: "", pickupAddress: "", deliveryAddress: "", cargoDescription: "", pickupDate: "" };

describe("suggestionAttempts", () => {
  it("aucune tentative tant que départ ou arrivée est vide", () => {
    expect(suggestionAttempts(input)).toEqual([]);
    expect(suggestionAttempts({ ...input, pickupAddress: "Douala" })).toEqual([]);
    expect(suggestionAttempts({ ...input, pickupAddress: "  ", deliveryAddress: "Kribi" })).toEqual([]);
  });
  it("adresses entières d'abord, puis repli sur la ville marqué matchedOnCity", () => {
    const a = suggestionAttempts({ ...input, pickupAddress: "Zone portuaire, Douala", deliveryAddress: "Yaoundé" });
    expect(a.map((x) => x.matchedOnCity)).toEqual([false, true]);
    expect(a[0].params).toMatchObject({ origin: "Zone portuaire, Douala", destination: "Yaoundé" });
    expect(a[1].params).toMatchObject({ origin: "Zone portuaire", destination: "Yaoundé" });
  });
  it("pas de repli quand les villes sont déjà les adresses", () => {
    expect(suggestionAttempts({ ...input, pickupAddress: "Douala", deliveryAddress: "Kribi" })).toHaveLength(1);
  });
  it("client, marchandise et date transmis seulement s'ils sont renseignés", () => {
    const [a] = suggestionAttempts({ ...input, pickupAddress: "A", deliveryAddress: "B" });
    expect(Object.keys(a.params).sort()).toEqual(["destination", "origin"]);
    const [b] = suggestionAttempts({ clientId: "7", pickupAddress: "A", deliveryAddress: "B", cargoDescription: " Coton ", pickupDate: "2026-06-01" });
    expect(b.params).toMatchObject({ clientId: "7", cargoType: "Coton", date: "2026-06-01" });
  });
  it("cityOf prend le texte avant la première virgule", () => {
    expect(cityOf(" Douala , Akwa, rue 1")).toBe("Douala");
  });
});

describe("suggestedMissionAmount", () => {
  it("à la tonne avec poids : prix × poids arrondi ; sinon prix du tarif", () => {
    expect(suggestedMissionAmount(1000, "ton", 12.5)).toBe(12500);
    expect(suggestedMissionAmount(1000, "ton", null)).toBe(1000);
    expect(suggestedMissionAmount(1000, "ton", 0)).toBe(1000);
    expect(suggestedMissionAmount(1000, "ton", Number.NaN)).toBe(1000);
    expect(suggestedMissionAmount(150000, "trip", 12)).toBe(150000);
  });
});

describe("parseAgreedPrice", () => {
  it("vide = pas de prix ; entier valide ; décimale, signe, texte = invalide", () => {
    expect(parseAgreedPrice("  ")).toBeNull();
    expect(parseAgreedPrice("125000")).toBe(125000);
    expect(parseAgreedPrice("0")).toBe(0);
    for (const bad of ["10.5", "-1", "abc", "1 000", "1,5"]) expect(parseAgreedPrice(bad), bad).toBe("invalid");
  });
});

describe("canSetMissionPrice", () => {
  it("admin, logistique, secrétariat ; ni technicien, chauffeur, client ni direction seule", () => {
    for (const r of ["admin", "logistics", "secretary"]) expect(canSetMissionPrice(r), r).toBe(true);
    for (const r of ["technician", "driver", "client", "management", undefined, null]) expect(canSetMissionPrice(r), String(r)).toBe(false);
  });
});
