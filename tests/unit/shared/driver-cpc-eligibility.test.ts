import { describe, expect, it } from "vitest";
import {
  CPC_VALIDITY_DAYS,
  cpcExpiryDayOf,
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

  describe("expiration de la formation (date + durée de validité, jour J valable)", () => {
    const TODAY = "2026-11-05";

    it("date absente, statut FORMÉ : éligible (cas du défaut d'origine)", () => {
      expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: null }, TODAY).eligible).toBe(true);
    });

    it("formation récente : éligible", () => {
      expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2026-01-10" }, TODAY).eligible).toBe(true);
    });

    it("statut FORMÉ mais formation il y a 800 jours : refusée, date lisible", () => {
      const r = getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2024-08-26" }, TODAY);
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("Formation CPC expirée le 27/08/2026.");
    });

    it("dernier jour de validité valable, lendemain expiré", () => {
      const expiry = cpcExpiryDayOf("2024-11-05");
      expect(expiry).toBe("2026-11-06");
      expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2024-11-05" }, "2026-11-06").eligible).toBe(true);
      expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2024-11-05" }, "2026-11-07").eligible).toBe(false);
    });

    it("la durée de validité est la constante partagée", () => {
      expect(CPC_VALIDITY_DAYS).toBe(731);
    });
  });
});
