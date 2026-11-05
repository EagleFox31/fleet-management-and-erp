import { describe, expect, it } from "vitest";
import {
  CPC_INELIGIBLE_LABELS,
  cpcStatusTone,
  getDriverCpcEligibility,
  type CpcIneligibleCode,
} from "@shared/constants/driver-cpc-eligibility";

/** Motif de refus stable et libellé fixe, sans date : diffusés avec la liste des missions. */
describe("éligibilité CPC : code de raison et libellé fixe", () => {
  const TODAY = "2026-11-05";
  const DATE = /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;

  it("formation expirée : EXPIRED, libellé sans date, raison datée conservée", () => {
    const r = getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2024-08-26" }, TODAY);
    expect(r).toMatchObject({ eligible: false, code: "EXPIRED", label: CPC_INELIGIBLE_LABELS.EXPIRED });
    expect(r.label).not.toMatch(DATE);
    expect(r.reason).toBe("Formation CPC expirée le 27/08/2026.");
  });

  it("statut non valide : NOT_VALID, le libellé fixe ne reprend pas le statut saisi", () => {
    const r = getDriverCpcEligibility({ cpcStatus: "NON FORMÉ" }, TODAY);
    expect(r).toMatchObject({ eligible: false, code: "NOT_VALID", label: CPC_INELIGIBLE_LABELS.NOT_VALID });
    expect(r.label).not.toContain("NON FORMÉ");
    expect(r.reason).toContain("NON FORMÉ");
  });

  it("statut absent : MISSING", () => {
    expect(getDriverCpcEligibility({ cpcStatus: null }, TODAY)).toMatchObject({ eligible: false, code: "MISSING" });
  });

  it("FORMÉ avec une date de formation à J+30 (import SQL) : inéligible, FUTURE_DATE", () => {
    const r = getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: "2026-12-05" }, TODAY);
    expect(r).toMatchObject({ eligible: false, code: "FUTURE_DATE", label: CPC_INELIGIBLE_LABELS.FUTURE_DATE });
    expect(r.label).not.toMatch(DATE);
  });

  it("formation datée d'aujourd'hui : éligible, sans code", () => {
    expect(getDriverCpcEligibility({ cpcStatus: "FORMÉ", cpcTrainingDate: TODAY }, TODAY)).toEqual({ eligible: true });
  });

  it("aucun libellé fixe ne contient de date", () => {
    for (const code of Object.keys(CPC_INELIGIBLE_LABELS) as CpcIneligibleCode[]) {
      expect(CPC_INELIGIBLE_LABELS[code], code).not.toMatch(DATE);
    }
  });
});

describe("cpcStatusTone", () => {
  it("FORMÉ, avec ou sans accent, même casse ou non : success", () => {
    for (const v of ["FORMÉ", "FORME", "formé", "Formé"]) expect(cpcStatusTone(v)).toBe("success");
  });
  it("À FORMER sous toutes ses graphies : warning", () => {
    for (const v of ["À FORMER", "A FORMER", "a former", "à former"]) expect(cpcStatusTone(v)).toBe("warning");
  });
  it("NON FORMÉ sous toutes ses graphies : danger", () => {
    for (const v of ["NON FORMÉ", "NON FORME", "Non Formé", "non forme"]) expect(cpcStatusTone(v)).toBe("danger");
  });
  it("absent ou inconnu : neutral", () => {
    for (const v of [null, undefined, "", "INCONNU"]) expect(cpcStatusTone(v)).toBe("neutral");
  });
  it("la graphie sans accent donne le même ton que la graphie accentuée", () => {
    expect(cpcStatusTone("FORME")).toBe(cpcStatusTone("FORMÉ"));
    expect(cpcStatusTone("a former")).toBe(cpcStatusTone("À FORMER"));
    expect(cpcStatusTone("Non Formé")).toBe(cpcStatusTone("NON FORME"));
  });
});
