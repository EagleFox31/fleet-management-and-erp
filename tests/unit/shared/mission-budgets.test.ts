import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID as MAX_ID_FOR_TEST } from "../../../shared/contracts/common";
import {
  computeMissionBudget,
  createMissionBudgetRequestSchema,
  isBudgetDateInWindow,
  missionBudgetDisburseRequestSchema,
  missionBudgetTransitionRequestSchema,
  updateMissionBudgetRequestSchema,
} from "../../../shared/contracts/mission-budgets";

describe("L1 : calcul du budget de mission", () => {
  it("carburant = litres × prix du jour ; total = carburant + FDR + extras", () => {
    expect(computeMissionBudget({ fuelLiters: 300, fuelUnitPrice: 828, fdrAmount: 50_000, extrasAmount: 10_000 })).toEqual({
      fuelAmount: 248_400,
      totalAmount: 308_400,
    });
  });

  it("arrondit le carburant au centime, sans dérive flottante", () => {
    // 0,1 × 0,2 vaut 0,020000000000000004 en flottant.
    expect(computeMissionBudget({ fuelLiters: 0.1, fuelUnitPrice: 0.2, fdrAmount: 0, extrasAmount: 0 }).fuelAmount).toBe(0.02);
    expect(computeMissionBudget({ fuelLiters: 12.35, fuelUnitPrice: 828.5, fdrAmount: 0.1, extrasAmount: 0.2 })).toEqual({
      fuelAmount: 10_231.98,
      totalAmount: 10_232.28,
    });
  });

  it("aucun carburant : le total vaut FDR + extras", () => {
    expect(computeMissionBudget({ fuelLiters: 0, fuelUnitPrice: 828, fdrAmount: 25_000, extrasAmount: 0 }).totalAmount).toBe(25_000);
  });
});

describe("L1 : contrat de saisie", () => {
  const valid = { missionId: 1, budgetDate: "2026-11-05", fuelLiters: 300, fdrAmount: 50_000 };

  it("extras à 0 par défaut", () => {
    expect(createMissionBudgetRequestSchema.parse(valid).extrasAmount).toBe(0);
  });

  it("le client n'écrit ni le prix, ni les montants calculés, ni le statut", () => {
    for (const extra of [{ fuelUnitPrice: 1 }, { fuelAmount: 1 }, { totalAmount: 1 }, { status: "approved" }]) {
      expect(createMissionBudgetRequestSchema.safeParse({ ...valid, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("refuse montants négatifs, litres négatifs et mission hors plage int4", () => {
    expect(createMissionBudgetRequestSchema.safeParse({ ...valid, fdrAmount: -1 }).success).toBe(false);
    expect(createMissionBudgetRequestSchema.safeParse({ ...valid, fuelLiters: -1 }).success).toBe(false);
    expect(createMissionBudgetRequestSchema.safeParse({ ...valid, missionId: MAX_ID_FOR_TEST + 1 }).success).toBe(false);
  });

  it("une correction ne change pas de mission et porte au moins un champ", () => {
    expect(updateMissionBudgetRequestSchema.safeParse({ missionId: 2 }).success).toBe(false);
    expect(updateMissionBudgetRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMissionBudgetRequestSchema.safeParse({ fdrAmount: 1 }).success).toBe(true);
  });
});

describe("L1b : saisie par destination du barème", () => {
  const base = { missionId: 1, budgetDate: "2026-11-05" };

  it("avec une destination, litres et FDR sont facultatifs (pré-remplis par le serveur)", () => {
    expect(createMissionBudgetRequestSchema.safeParse({ ...base, destinationId: 3 }).success).toBe(true);
    expect(createMissionBudgetRequestSchema.safeParse({ ...base, destinationId: 3, fdrAmount: 80_000 }).success).toBe(true);
  });

  it("sans destination, litres et FDR sont requis", () => {
    for (const extra of [{}, { fuelLiters: 300 }, { fdrAmount: 50_000 }, { destinationId: null, fuelLiters: 300 }]) {
      expect(createMissionBudgetRequestSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(createMissionBudgetRequestSchema.safeParse({ ...base, fuelLiters: 300, fdrAmount: 50_000 }).success).toBe(true);
  });

  it("destination hors plage int4 ou non entière : refusée ; une correction peut la retirer (null)", () => {
    for (const destinationId of [0, -1, 1.5, MAX_ID_FOR_TEST + 1]) {
      expect(createMissionBudgetRequestSchema.safeParse({ ...base, destinationId }).success, String(destinationId)).toBe(false);
    }
    expect(updateMissionBudgetRequestSchema.safeParse({ destinationId: null }).success).toBe(true);
  });
});

describe("L1 : garde-fous de sécurité", () => {
  it("date du budget : fenêtre de 60 jours de part et d'autre, bornes incluses, passage d'année", () => {
    expect(isBudgetDateInWindow("2026-11-05", "2026-11-05")).toBe(true);
    expect(isBudgetDateInWindow("2027-01-04", "2026-11-05")).toBe(true);
    expect(isBudgetDateInWindow("2027-01-05", "2026-11-05")).toBe(false);
    expect(isBudgetDateInWindow("2026-09-06", "2026-11-05")).toBe(true);
    expect(isBudgetDateInWindow("2026-09-05", "2026-11-05")).toBe(false);
  });

  it("approbation et décaissement exigent la version lue, rien d'autre", () => {
    expect(missionBudgetTransitionRequestSchema.safeParse({}).success).toBe(false);
    expect(missionBudgetTransitionRequestSchema.safeParse({ expectedUpdatedAt: "hier" }).success).toBe(false);
    expect(missionBudgetTransitionRequestSchema.safeParse({ expectedUpdatedAt: "2026-11-05T10:00:00.000Z", status: "disbursed" }).success).toBe(false);
    expect(missionBudgetTransitionRequestSchema.safeParse({ expectedUpdatedAt: "2026-11-05T10:00:00.000Z" }).success).toBe(true);
  });
});

describe("L1c : contrat de décaissement", () => {
  const v = "2026-11-05T10:00:00.000Z";

  it("compte de trésorerie facultatif (absent ou null : marquage), entier positif int4 sinon", () => {
    expect(missionBudgetDisburseRequestSchema.safeParse({ expectedUpdatedAt: v }).success).toBe(true);
    expect(missionBudgetDisburseRequestSchema.safeParse({ expectedUpdatedAt: v, treasuryAccountId: null }).success).toBe(true);
    expect(missionBudgetDisburseRequestSchema.safeParse({ expectedUpdatedAt: v, treasuryAccountId: 3 }).success).toBe(true);
    for (const treasuryAccountId of [0, -1, 1.5, "3", MAX_ID_FOR_TEST + 1]) {
      expect(missionBudgetDisburseRequestSchema.safeParse({ expectedUpdatedAt: v, treasuryAccountId }).success, String(treasuryAccountId)).toBe(false);
    }
  });

  it("strict : ni montant ni statut ; la version reste requise ; l'approbation n'accepte pas de compte", () => {
    expect(missionBudgetDisburseRequestSchema.safeParse({ treasuryAccountId: 3 }).success).toBe(false);
    expect(missionBudgetDisburseRequestSchema.safeParse({ expectedUpdatedAt: v, amount: 1 }).success).toBe(false);
    expect(missionBudgetTransitionRequestSchema.safeParse({ expectedUpdatedAt: v, treasuryAccountId: 3 }).success).toBe(false);
  });
});
