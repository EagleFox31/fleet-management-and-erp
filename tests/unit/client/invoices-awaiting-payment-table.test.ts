import { describe, expect, it } from "vitest";
import {
  DEPOSIT_INVALIDATED_KEYS,
  IS_BASE_LABELS,
  depositUrgency,
  withDepositedItem,
} from "@/components/finance/invoices-awaiting-payment-table";
import { canWriteFinanceReceivable } from "@shared/constants/roles";
import type { InvoiceAwaitingPayment } from "@shared/contracts/invoices-awaiting-payment";

function row(invoiceId: number, overrides: Partial<InvoiceAwaitingPayment> = {}): InvoiceAwaitingPayment {
  return {
    invoiceId,
    invoiceNumber: `FAC-${invoiceId}`,
    clientId: 1,
    clientName: "CNPCC",
    amountHt: 100000,
    amountTtc: 119250,
    withholdingVatAmount: 19250,
    withholdingIsAmount: 2200,
    netPayable: 97800,
    withholdingIsBase: "ht",
    withholdingFrozen: false,
    depositedAt: null,
    daysSinceDeposit: null,
    ...overrides,
  };
}

describe("écran factures en attente de paiement (F1c)", () => {
  it("compteur de jours : faible jusqu'à 30, moyen jusqu'à 60, critique au-delà", () => {
    expect([0, 30, 31, 60, 61].map(depositUrgency)).toEqual(["low", "low", "medium", "medium", "critical"]);
  });

  it("affiche la base IS de chaque ligne", () => {
    expect(IS_BASE_LABELS).toEqual({ ht: "IS sur HT", ttc: "IS sur TTC" });
  });

  it("couche 1 : remplace la ligne déposée et recalcule les totaux", () => {
    const data = {
      items: [row(1), row(2)],
      totals: { count: 2, amountHt: 200000, amountTtc: 238500, withholdingVatAmount: 38500, withholdingIsAmount: 4400, netPayable: 195600 },
    };
    const deposited = row(2, { withholdingIsAmount: 2000, netPayable: 98000, withholdingFrozen: true, depositedAt: "2026-11-01", daysSinceDeposit: 4 });
    const next = withDepositedItem(data, deposited)!;
    expect(next.items[1]).toEqual(deposited);
    expect(next.items[0]).toBe(data.items[0]);
    expect(next.totals).toMatchObject({ count: 2, withholdingIsAmount: 4200, netPayable: 195800 });
    expect(withDepositedItem(undefined, deposited)).toBeUndefined();
  });

  it("couche 3 : invalide la liste, les factures client et le tableau de bord direction", () => {
    expect(DEPOSIT_INVALIDATED_KEYS).toEqual(
      expect.arrayContaining(["/api/finance/invoices-awaiting-payment", "/api/billing/invoices", "/api/management/dashboard"]),
    );
    expect(new Set(DEPOSIT_INVALIDATED_KEYS).size).toBe(DEPOSIT_INVALIDATED_KEYS.length);
  });

  it("dépôt réservé à admin et secrétariat ; la direction consulte", () => {
    expect(["admin", "secretary", "management", "logistics", null].map(canWriteFinanceReceivable)).toEqual([true, true, false, false, false]);
  });
});
