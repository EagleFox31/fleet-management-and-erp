import { describe, expect, it } from "vitest";
import { canReadMissionBudget, formatXaf, missionBudgetActions, remainingOf, toDisburseOf } from "../../../client/src/lib/mission-budget-ui";
import { ALL_APP_ROLES } from "@shared/constants/roles";

const none = { create: false, edit: false, approve: false, disburse: false, expenses: false, settle: false };

describe("budget de mission (L1f) : actions visibles selon le rôle et les statuts", () => {
  it("lecture : logistique, direction, secrétariat, administrateur ; aucun autre rôle", () => {
    const readers = ALL_APP_ROLES.filter((role) => canReadMissionBudget(role));
    expect([...readers].sort()).toEqual(["admin", "logistics", "management", "secretary"]);
    expect(canReadMissionBudget(undefined)).toBe(false);
  });

  it("sans budget : seuls la logistique et l'administrateur saisissent", () => {
    expect(missionBudgetActions("logistics", null, "planned")).toEqual({ ...none, create: true });
    expect(missionBudgetActions("admin", null, "planned")).toEqual({ ...none, create: true });
    for (const role of ["management", "secretary", "technician", "client"]) expect(missionBudgetActions(role, null, "planned"), role).toEqual(none);
  });

  it("chaque statut n'ouvre que son étape : corriger et approuver, puis décaisser, puis justifier", () => {
    expect(missionBudgetActions("logistics", { status: "requested" }, "planned")).toEqual({ ...none, edit: true });
    expect(missionBudgetActions("management", { status: "requested" }, "planned")).toEqual({ ...none, approve: true });
    expect(missionBudgetActions("admin", { status: "requested" }, "planned")).toEqual({ ...none, edit: true, approve: true });
    expect(missionBudgetActions("secretary", { status: "approved" }, "in_progress")).toEqual({ ...none, disburse: true });
    expect(missionBudgetActions("management", { status: "approved" }, "in_progress"), "qui approuve ne décaisse pas").toEqual(none);
    expect(missionBudgetActions("logistics", { status: "disbursed" }, "delivered")).toEqual({ ...none, expenses: true });
    expect(missionBudgetActions("management", { status: "disbursed" }, "delivered")).toEqual(none);
  });

  it("mission terminée ou annulée : plus aucune action sur le budget, même pour l'administrateur", () => {
    for (const status of ["completed", "cancelled"]) {
      expect(missionBudgetActions("admin", null, status), status).toEqual(none);
      expect(missionBudgetActions("admin", { status: "requested" }, status), status).toEqual(none);
      expect(missionBudgetActions("admin", { status: "approved" }, status), status).toEqual(none);
    }
  });

  it("dépenses (R1) : ouvertes sur mission terminée pour qui décaisse ; jamais sur mission annulée", () => {
    for (const role of ["admin", "secretary", "logistics"]) {
      expect(missionBudgetActions(role, { status: "disbursed" }, "completed"), role).toEqual({ ...none, expenses: true, settle: role !== "logistics" });
      expect(missionBudgetActions(role, { status: "disbursed" }, "cancelled"), role).toEqual(none);
    }
    expect(missionBudgetActions("management", { status: "disbursed" }, "completed"), "qui approuve ne justifie pas").toEqual(none);
  });

  it("solde (Q18) : mission terminée, budget décaissé, administrateur et secrétariat ; ensuite dépenses figées", () => {
    for (const role of ["admin", "secretary"]) {
      expect(missionBudgetActions(role, { status: "disbursed", settledAt: null }, "completed").settle, role).toBe(true);
      expect(missionBudgetActions(role, { status: "disbursed" }, "delivered").settle, `${role} : mission livrée, pas terminée`).toBe(false);
      expect(missionBudgetActions(role, { status: "approved" }, "completed").settle, `${role} : non décaissé`).toBe(false);
      expect(missionBudgetActions(role, { status: "disbursed", settledAt: "2026-11-06T10:00:00.000Z" }, "completed"), `${role} : déjà soldé`).toEqual(none);
    }
    for (const role of ["logistics", "management", "technician", "driver", "client"]) {
      expect(missionBudgetActions(role, { status: "disbursed" }, "completed").settle, role).toBe(false);
    }
  });

  it("reste d'une ligne : 0 si la ligne est absente ou les dépenses pas encore lues", () => {
    const expenses = { budgetId: 1, expenses: [], lines: [{ line: "fdr" as const, disbursed: 50_000, justified: 20_000, remaining: 30_000 }] };
    expect(remainingOf(expenses, "fdr")).toBe(30_000);
    expect(remainingOf(expenses, "carburant")).toBe(0);
    expect(remainingOf(undefined, "fdr")).toBe(0);
  });

  it("reste à décaisser du jour : demandés + approuvés, jamais les décaissés ; 0 tant que rien n'est lu", () => {
    const stat = (totalAmount: number) => ({ count: 1, fuelAmount: 0, fdrAmount: 0, extrasAmount: 0, totalAmount });
    const byStatus = { requested: stat(100_000), approved: stat(250_000), disbursed: stat(900_000) };
    expect(toDisburseOf({ byStatus } as never)).toBe(350_000);
    expect(toDisburseOf({ byStatus: { disbursed: stat(900_000) } } as never)).toBe(0);
    expect(toDisburseOf(undefined)).toBe(0);
  });

  it("montant en FCFA arrondi à l'unité, séparateur de milliers", () => {
    expect(formatXaf(227_300.4).replace(/\s/g, " ")).toBe("227 300 FCFA");
    expect(formatXaf(0)).toBe("0 FCFA");
  });
});
