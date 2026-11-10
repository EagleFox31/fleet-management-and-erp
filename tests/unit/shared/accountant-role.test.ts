import { describe, expect, it } from "vitest";
import {
  ALL_APP_ROLES,
  CLIENT_BILLING_EVENT_ROLES,
  DRIVER_MANAGER_ROLES,
  FINANCE_RECEIVABLE_READ_ROLES,
  FINANCE_RECEIVABLE_WRITE_ROLES,
  FUEL_CARD_MANAGER_ROLES,
  FUEL_PRICE_WRITE_ROLES,
  FUEL_READ_ROLES,
  FUEL_RECHARGE_SOURCE_ROLES,
  FUEL_WRITE_ROLES,
  INVENTORY_MANAGER_ROLES,
  KPI_VIEWER_ROLES,
  MISSION_BUDGET_APPROVE_ROLES,
  MISSION_BUDGET_DISBURSE_ROLES,
  MISSION_BUDGET_READ_ROLES,
  MISSION_BUDGET_SETTLE_ROLES,
  MISSION_BUDGET_WRITE_ROLES,
  MISSION_MANAGER_ROLES,
  PENDING_INVOICE_ROLES,
  PROCUREMENT_ROLES,
  ROLE_LABELS,
  STAFF_ROLES,
  STOCK_ISSUER_ROLES,
  SUPPLIER_INVOICE_PAYMENT_ROLES,
  SUPPLIER_INVOICE_READ_ROLES,
  TREASURY_READ_ROLES,
  TREASURY_WRITE_ROLES,
  VEHICLE_EDIT_ROLES,
  WORK_ORDER_COST_READ_ROLES,
} from "../../../shared/constants/roles";

/**
 * Rôle `accountant` (comptable), ajouté le 10 novembre 2026, en **addition** : la secrétaire garde
 * tous ses droits (saisie, règlement). Le comptable tient l'argent — factures fournisseur, facturation
 * client, trésorerie — lit le carburant et la carte, et n'écrit rien d'opérationnel (atelier, stock,
 * missions, flotte, recharge de la carte).
 */
const has = (group: readonly string[]) => group.includes("accountant");

describe("rôle comptable : définition", () => {
  it("existe dans le schéma, avec un libellé", () => {
    expect(ALL_APP_ROLES).toContain("accountant");
    expect(ROLE_LABELS.accountant).toBe("Comptable");
    expect(STAFF_ROLES).toContain("accountant");
    expect(WORK_ORDER_COST_READ_ROLES).toContain("accountant");
  });
});

describe("rôle comptable : groupes finance", () => {
  it.each([
    ["SUPPLIER_INVOICE_READ_ROLES", SUPPLIER_INVOICE_READ_ROLES],
    ["SUPPLIER_INVOICE_PAYMENT_ROLES", SUPPLIER_INVOICE_PAYMENT_ROLES],
    ["CLIENT_BILLING_EVENT_ROLES", CLIENT_BILLING_EVENT_ROLES],
    ["PENDING_INVOICE_ROLES", PENDING_INVOICE_ROLES],
    ["FINANCE_RECEIVABLE_READ_ROLES", FINANCE_RECEIVABLE_READ_ROLES],
    ["FINANCE_RECEIVABLE_WRITE_ROLES", FINANCE_RECEIVABLE_WRITE_ROLES],
    ["TREASURY_READ_ROLES", TREASURY_READ_ROLES],
    ["TREASURY_WRITE_ROLES", TREASURY_WRITE_ROLES],
    ["FUEL_READ_ROLES", FUEL_READ_ROLES],
    ["MISSION_BUDGET_READ_ROLES", MISSION_BUDGET_READ_ROLES],
    ["MISSION_BUDGET_DISBURSE_ROLES", MISSION_BUDGET_DISBURSE_ROLES],
    ["MISSION_BUDGET_SETTLE_ROLES", MISSION_BUDGET_SETTLE_ROLES],
  ] as const)("%s contient le comptable", (_name, group) => {
    expect(has(group)).toBe(true);
  });

  it("la secrétaire garde ses droits (ajout, pas de séparation stricte)", () => {
    for (const group of [SUPPLIER_INVOICE_PAYMENT_ROLES, TREASURY_WRITE_ROLES, FINANCE_RECEIVABLE_WRITE_ROLES, MISSION_BUDGET_SETTLE_ROLES]) {
      expect(group).toContain("secretary");
    }
  });
});

describe("rôle comptable : hors des écritures opérationnelles", () => {
  it.each([
    ["PROCUREMENT_ROLES (commandes)", PROCUREMENT_ROLES],
    ["VEHICLE_EDIT_ROLES", VEHICLE_EDIT_ROLES],
    ["DRIVER_MANAGER_ROLES", DRIVER_MANAGER_ROLES],
    ["INVENTORY_MANAGER_ROLES", INVENTORY_MANAGER_ROLES],
    ["STOCK_ISSUER_ROLES", STOCK_ISSUER_ROLES],
    ["MISSION_MANAGER_ROLES", MISSION_MANAGER_ROLES],
    ["MISSION_BUDGET_WRITE_ROLES", MISSION_BUDGET_WRITE_ROLES],
    ["MISSION_BUDGET_APPROVE_ROLES", MISSION_BUDGET_APPROVE_ROLES],
    ["FUEL_WRITE_ROLES", FUEL_WRITE_ROLES],
    ["FUEL_PRICE_WRITE_ROLES", FUEL_PRICE_WRITE_ROLES],
    // La recharge de la carte reste une opération carburant (dérogation du 5 novembre 2026 inchangée).
    ["FUEL_CARD_MANAGER_ROLES", FUEL_CARD_MANAGER_ROLES],
    ["FUEL_RECHARGE_SOURCE_ROLES", FUEL_RECHARGE_SOURCE_ROLES],
    ["KPI_VIEWER_ROLES", KPI_VIEWER_ROLES],
  ] as const)("%s ne contient pas le comptable", (_name, group) => {
    expect(has(group)).toBe(false);
  });
});
