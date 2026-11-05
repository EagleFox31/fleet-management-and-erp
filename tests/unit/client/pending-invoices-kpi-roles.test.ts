import { describe, expect, it } from "vitest";
import { TO_QUOTE_LABEL, isToQuote } from "../../../client/src/components/billing/pending-invoices-table";
import { ALL_APP_ROLES, KPI_VIEWER_ROLES, canViewKpi } from "../../../shared/constants/roles";

describe("montant des factures en attente", () => {
  it("« À chiffrer » seulement quand aucune opération n'a de prix", () => {
    expect(TO_QUOTE_LABEL).toBe("À chiffrer");
    expect(isToQuote({ operationCount: 2, missionsWithoutPrice: 2 })).toBe(true);
  });
  it("une opération au moins valorisée garde le montant affiché", () => {
    expect(isToQuote({ operationCount: 2, missionsWithoutPrice: 1 })).toBe(false);
    expect(isToQuote({ operationCount: 1, missionsWithoutPrice: 0 })).toBe(false);
  });
});

describe("garde de rôle des tuiles KPI", () => {
  it("direction, administrateur et chef d'atelier seulement (CDC #7)", () => {
    const expected = ["admin", "management", "workshop_manager"];
    expect([...KPI_VIEWER_ROLES].sort()).toEqual(expected);
    for (const role of ALL_APP_ROLES) {
      expect(canViewKpi(role)).toBe(expected.includes(role));
    }
  });
  it("rôle absent ou inconnu : refusé", () => {
    expect(canViewKpi(undefined)).toBe(false);
    expect(canViewKpi(null)).toBe(false);
    expect(canViewKpi("")).toBe(false);
  });
});
