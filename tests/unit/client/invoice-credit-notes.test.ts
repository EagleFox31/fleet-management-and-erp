import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canIssueCreditNote, creditNoteBlockerOf, creditNotesKeyOf, type CreditableInvoice } from "@/lib/credit-note-rules";
import { creditNoteAmounts, maxCreditNoteHtOf, paidTtcOf } from "@shared/constants/client-invoices";
import { creditNoteAmounts as serverCreditNoteAmounts } from "../../../server/lib/credit-note-amounts";

const invoice = (overrides: Partial<CreditableInvoice> = {}): CreditableInvoice => ({
  id: 7,
  invoiceNumber: "FAC-20261110-001",
  status: "pending",
  balance: "119250.00",
  vatRate: "19.25",
  depositedAt: null,
  ...overrides,
});

describe("écran des avoirs (V1, PR6)", () => {
  it("l'aperçu et le serveur calculent avec la même fonction", () => {
    expect(serverCreditNoteAmounts).toBe(creditNoteAmounts);
    expect(creditNoteAmounts(100000, "19.25")).toEqual({ htCents: 10000000, vatCents: 1925000, ttcCents: 11925000 });
  });

  it("plafond HT : le TTC tient dans le solde, un centime de plus le dépasse", () => {
    expect(maxCreditNoteHtOf("119250", "19.25")).toBe(100000);
    expect(maxCreditNoteHtOf("5000", "0")).toBe(5000);
    expect(maxCreditNoteHtOf("0", "19.25")).toBe(0);
    expect(maxCreditNoteHtOf("-3", "19.25")).toBe(0);

    for (const balance of ["1", "0.37", "999.99", "12345.67", "777777.77", "119249.99"]) {
      for (const rate of ["0", "5.5", "19.25", "20"]) {
        const max = maxCreditNoteHtOf(balance, rate);
        const balanceCents = Math.round(Number(balance) * 100);
        expect(creditNoteAmounts(max, rate).ttcCents).toBeLessThanOrEqual(balanceCents);
        expect(creditNoteAmounts(max + 0.01, rate).ttcCents).toBeGreaterThan(balanceCents);
      }
    }
  });

  it("émission réservée à l'administrateur et au comptable", () => {
    expect(["admin", "accountant"].map(canIssueCreditNote)).toEqual([true, true]);
    expect(["secretary", "management", "client", null, undefined].map(canIssueCreditNote)).toEqual([false, false, false, false, false]);
  });

  it("bouton désactivé avec la raison du serveur : annulée, soldée, déposée", () => {
    expect(creditNoteBlockerOf(invoice())).toBeNull();
    expect(creditNoteBlockerOf(invoice({ status: "cancelled" }))).toMatch(/annulée/);
    expect(creditNoteBlockerOf(invoice({ balance: "0", status: "paid" }))).toMatch(/soldée/);
    expect(creditNoteBlockerOf(invoice({ depositedAt: "2026-11-01" }))).toMatch(/déposée/);
  });

  it("payé affiché = TTC - avoirs - solde : un avoir n'est pas un encaissement", () => {
    expect(paidTtcOf({ amountTTC: "119250", creditedAmountTtc: "19250", balance: "100000" })).toBe(0);
    expect(paidTtcOf({ amountTTC: "119250", creditedAmountTtc: "19250", balance: "40000" })).toBe(60000);
  });

  it("couche 2 : l'événement d'avoir rafraîchit la liste des avoirs de la facture", () => {
    const source = readFileSync("client/src/hooks/useRealTimeSync.ts", "utf8");
    const block = source.slice(source.indexOf('case "client_credit_note_created":'));
    expect(block.slice(0, 2000)).toContain("/credit-notes`");
    expect(creditNotesKeyOf(7)).toBe("/api/billing/invoices/7/credit-notes");
  });
});
