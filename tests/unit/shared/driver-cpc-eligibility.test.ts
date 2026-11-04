import { describe, expect, it } from "vitest";
import {
  getDriverCpcEligibility,
  isCpcStatusValid,
  normalizeCpcStatus,
} from "@shared/constants/driver-cpc-eligibility";

describe("éligibilité CPC d'un chauffeur", () => {
  it("accepte un CPC valide, accents et casse ignorés", () => {
    expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ" }).eligible).toBe(true);
    expect(isCpcStatusValid("formé")).toBe(true);
    expect(isCpcStatusValid("FORME")).toBe(true);
    expect(normalizeCpcStatus("À FORMER")).toBe("A FORMER");
  });

  it("refuse un CPC expiré ou à renouveler, avec une raison lisible", () => {
    const r = getDriverCpcEligibility({ cpcStatus: "À FORMER" });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("À FORMER");
  });

  it("refuse un chauffeur sans statut", () => {
    const r = getDriverCpcEligibility({ cpcStatus: null });
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("non renseigné");
  });
});
