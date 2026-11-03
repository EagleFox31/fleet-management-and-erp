import { describe, expect, it } from "vitest";
import { TO_QUOTE_LABEL, isToQuote } from "../../../client/src/components/billing/pending-invoices-table";
import { ALL_APP_ROLES, KPI_VIEWER_ROLES, canViewKpi } from "../../../shared/constants/roles";

describe("montant des factures en attente", () => {
  it("un montant nul s'affiche « À chiffrer »", () => {
    expect(TO_QUOTE_LABEL).toBe("À chiffrer");
    expect(isToQuote(0)).toBe(true);
  });
  it("un montant renseigné reste un prix", () => {
    expect(isToQuote(150000)).toBe(false);
    expect(isToQuote(0.5)).toBe(false);
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
