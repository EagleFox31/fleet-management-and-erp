import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));

import { launchBudgetOf } from "../../../server/services/mission-launch-budget";

const row = (status: "requested" | "approved" | "disbursed") => ({ status, fuelAmount: "50000.00", fdrAmount: "20000.00", extrasAmount: "5000.00" });
const EMPTY = { fuelBudget: null, roadExpensesBudget: null, contingencyBudget: null };

describe("budget de lancement d'une mission (L1g, drapeau finance actif)", () => {
  it("aucun budget de mission : plan vide, consigne de créer et faire approuver", () => {
    expect(launchBudgetOf(undefined)).toEqual({
      plan: EMPTY,
      missingDetail: "Aucun budget de mission. Créer et faire approuver le budget dans l'onglet Budget.",
    });
  });

  it("budget seulement demandé : plan vide, consigne de le faire approuver", () => {
    expect(launchBudgetOf(row("requested"))).toEqual({
      plan: EMPTY,
      missingDetail: "Budget de mission en attente d'approbation. Le faire approuver dans l'onglet Budget.",
    });
  });

  it("approuvé ou décaissé : carburant, FDR et imprévus = montant carburant, FDR, frais annexes", () => {
    for (const status of ["approved", "disbursed"] as const) {
      expect(launchBudgetOf(row(status)), status).toEqual({
        plan: { fuelBudget: 50_000, roadExpensesBudget: 20_000, contingencyBudget: 5_000 },
        missingDetail: null,
      });
    }
  });
});
