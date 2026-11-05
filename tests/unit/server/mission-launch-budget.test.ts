import { afterEach, describe, expect, it, vi } from "vitest";

const budgetRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => budgetRows.rows }) }) },
}));

import {
  APPROVED_BUDGET_DETAIL,
  canReadFuelCardBalance,
  canReadLaunchBudgetAmounts,
  FUEL_BALANCE_OK_DETAIL,
  FUEL_SHORTFALL_DETAIL,
  hideLaunchBudgetAmounts,
  LEGACY_BUDGET_DETAIL,
  LEGACY_FUEL_SHORTFALL_DETAIL,
  launchBudgetOf,
  launchReadinessPresenter,
  resolveLaunchBudget,
} from "../../../server/services/mission-launch-budget";

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

describe("check-list de lancement hors des lecteurs du budget de mission", () => {
  const body = (balanceUnavailable: boolean) => {
    const fuelBalance = { key: "fuel_balance", passed: false, blocking: true, detail: "Solde insuffisant (1000 FCFA < 50000 FCFA)." };
    return {
      missionId: 7,
      checks: [
        { key: "budget_fuel", passed: true, blocking: true, detail: "50000 FCFA renseigné." },
        { key: "budget_road_expenses", passed: true, blocking: true, detail: "20000 FCFA renseigné." },
        { key: "budget_contingency", passed: false, blocking: true, detail: "Budget imprévus non renseigné." },
        fuelBalance,
        { key: "permis", passed: true, blocking: true, detail: "Permis valide." },
      ],
      blockingFailures: [fuelBalance],
      fuel: { requiredBudget: 50000, balance: 1000, balanceUnavailable },
      budgets: { fuelBudget: 50000, roadExpensesBudget: 20000, contingencyBudget: null, totalBudget: 70000 },
      budgetSuggestion: { fuelBudget: 48000, roadExpensesBudget: 19000, contingencyBudget: 4000, confidence: "high" },
    };
  };

  it("montants retirés, verdicts et autres contrôles conservés", () => {
    const out = hideLaunchBudgetAmounts(body(false));
    expect(out.checks.map((c) => [c.key, c.passed, c.detail])).toEqual([
      ["budget_fuel", true, APPROVED_BUDGET_DETAIL],
      ["budget_road_expenses", true, APPROVED_BUDGET_DETAIL],
      ["budget_contingency", false, "Budget imprévus non renseigné."],
      ["fuel_balance", false, FUEL_SHORTFALL_DETAIL],
      ["permis", true, "Permis valide."],
    ]);
    expect(out.blockingFailures.map((c) => c.detail)).toEqual([FUEL_SHORTFALL_DETAIL]);
    expect(out.budgets).toEqual({ fuelBudget: null, roadExpensesBudget: null, contingencyBudget: null, totalBudget: null });
    expect(out.fuel).toEqual({ requiredBudget: null, balance: null, balanceUnavailable: false });
    expect(out.budgetSuggestion).toBeNull();
    expect(out.missionId).toBe(7);
    expect(JSON.stringify(out)).not.toMatch(/50000|20000|48000|19000|1000 FCFA|"balance":1000/);
  });

  it("solde suffisant : « Solde suffisant. » sans montant hors des lecteurs du solde (Q19)", () => {
    const input = body(false);
    input.checks[3] = { key: "fuel_balance", passed: true, blocking: true, detail: "Solde OK (987654 FCFA)." };
    input.fuel.balance = 987654;
    const out = hideLaunchBudgetAmounts(input);
    expect(out.checks[3].detail).toBe(FUEL_BALANCE_OK_DETAIL);
    expect(JSON.stringify(out)).not.toContain("987654");
  });

  it("droits séparés : budget lisible sans le solde, solde lisible sans le budget", () => {
    const budgetOnly = launchReadinessPresenter({ budget: true, balance: false })(body(false));
    expect(budgetOnly.budgets.fuelBudget).toBe(50000);
    expect(budgetOnly.budgetSuggestion).not.toBeNull();
    expect(budgetOnly.fuel).toEqual({ requiredBudget: 50000, balance: null, balanceUnavailable: false });
    expect(budgetOnly.checks[3].detail).toBe(FUEL_SHORTFALL_DETAIL);
    const balanceOnly = launchReadinessPresenter({ budget: false, balance: true })(body(false));
    expect(balanceOnly.fuel).toEqual({ requiredBudget: null, balance: 1000, balanceUnavailable: false });
    expect(balanceOnly.checks[3].detail).toBe(FUEL_SHORTFALL_DETAIL);
    const both = body(false);
    expect(launchReadinessPresenter({ budget: true, balance: true })(both)).toBe(both);
  });

  it("ancien budget (drapeau coupé) : « renseigné » et « prévu », jamais « approuvé »", () => {
    const out = launchReadinessPresenter({ budget: false, balance: false }, { passed: LEGACY_BUDGET_DETAIL, shortfall: LEGACY_FUEL_SHORTFALL_DETAIL })(body(false));
    expect(out.checks.map((c) => c.detail).slice(0, 4)).toEqual([LEGACY_BUDGET_DETAIL, LEGACY_BUDGET_DETAIL, "Budget imprévus non renseigné.", LEGACY_FUEL_SHORTFALL_DETAIL]);
    expect(JSON.stringify(out)).not.toMatch(/50000|20000|48000|approuvé/);
  });

  it("solde indisponible : motif d'origine conservé (il ne contient aucun montant)", () => {
    const input = body(true);
    input.checks[3].detail = "Solde carte carburant indisponible pour contrôle. Réessayez.";
    expect(hideLaunchBudgetAmounts(input).checks[3].detail).toBe("Solde carte carburant indisponible pour contrôle. Réessayez.");
  });

  it("lecteurs du budget : admin, logistique, direction, secrétariat ; pas le technicien ni un rôle absent", () => {
    expect(["admin", "logistics", "management", "secretary"].map(canReadLaunchBudgetAmounts)).toEqual([true, true, true, true]);
    expect(["technician", "driver", "warehouse", "", null, undefined].map(canReadLaunchBudgetAmounts)).toEqual([false, false, false, false, false, false]);
  });

  it("lecteurs du solde carte : TREASURY_FUEL_CARD_READ_ROLES ; pas le technicien ni le chauffeur", () => {
    expect(["admin", "secretary", "management", "logistics"].map(canReadFuelCardBalance)).toEqual([true, true, true, true]);
    expect(["technician", "driver", "warehouse", "", null, undefined].map(canReadFuelCardBalance)).toEqual([false, false, false, false, false, false]);
  });
});

describe("motif de solde insuffisant au lancement (PUT de statut)", () => {
  const previousFlags = process.env.FEATURE_FLAGS;
  const legacy = { fuelBudget: 111000, roadExpensesBudget: 22000, contingencyBudget: 3000 };
  afterEach(() => {
    if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = previousFlags;
  });

  it("drapeau actif, chauffeur (non lecteur) : pas de montant ; logistique : montants", async () => {
    process.env.FEATURE_FLAGS = "finance=on";
    budgetRows.rows = [row("approved")];
    expect((await resolveLaunchBudget(1, legacy, "driver")).fuelShortfallMotif(1000, 50000)).toBe(FUEL_SHORTFALL_DETAIL);
    expect((await resolveLaunchBudget(1, legacy, "logistics")).fuelShortfallMotif(1000.4, 50000)).toBe(
      "Solde carte carburant insuffisant (1000 FCFA < 50000 FCFA).",
    );
  });

  it("drapeau coupé (Q19) : chauffeur sans montant, ancien budget dit « prévu » ; logistique : montants", async () => {
    process.env.FEATURE_FLAGS = "finance=off";
    const driver = await resolveLaunchBudget(1, legacy, "driver");
    expect(driver.plan).toEqual(legacy);
    expect(driver.fuelShortfallMotif(1000, 111000)).toBe(LEGACY_FUEL_SHORTFALL_DETAIL);
    expect((await resolveLaunchBudget(1, legacy, "logistics")).fuelShortfallMotif(1000, 111000)).toBe(
      "Solde carte carburant insuffisant (1000 FCFA < 111000 FCFA).",
    );
  });
});
