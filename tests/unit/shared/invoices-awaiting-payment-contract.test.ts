import { describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID } from "../../../shared/contracts/common";
import {
  INVOICES_AWAITING_PAYMENT_PATH,
  clientWithholdingRequestSchema,
  invoiceDepositRequestSchema,
  invoicesAwaitingPaymentResponseSchema,
} from "../../../shared/contracts/invoices-awaiting-payment";
import { computeWithholdings, daysSinceDeposit } from "../../../shared/finance/withholding";

const CNPCC = { vatWithholdingRate: 19.25, isWithholdingRate: 2.2, isBase: "ht" as const };

function item(overrides: Record<string, unknown> = {}) {
  const amounts = { amountHt: 15467520, amountTtc: 18445018 };
  return {
    invoiceId: 1,
    invoiceNumber: "FAC-2026-001",
    clientId: 7,
    clientName: "CNPCC",
    ...amounts,
    ...computeWithholdings(amounts, CNPCC),
    withholdingIsBase: "ht",
    withholdingFrozen: true,
    depositedAt: "2026-10-10",
    daysSinceDeposit: daysSinceDeposit("2026-10-10", "2026-11-05"),
    balanceDue: 10000,
    ...overrides,
  };
}

const totals = {
  count: 1, amountHt: 15467520, amountTtc: 18445018,
  withholdingVatAmount: 2977498, withholdingIsAmount: 340285, netPayable: 15127235,
};

describe("contrat factures en attente de paiement", () => {
  it("vit sous /api/finance, distinct des factures en attente P-21", () => {
    expect(INVOICES_AWAITING_PAYMENT_PATH).toBe("/api/finance/invoices-awaiting-payment");
  });

  it("accepte une ligne calculée par le module de retenues", () => {
    const parsed = invoicesAwaitingPaymentResponseSchema.parse({ items: [item()], totals });
    expect(parsed.items[0]).toMatchObject({ netPayable: 15127235, daysSinceDeposit: 26 });
  });

  it("accepte une facture pas encore déposée", () => {
    const r = invoicesAwaitingPaymentResponseSchema.safeParse({
      items: [item({ depositedAt: null, daysSinceDeposit: null })], totals,
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["id hors plage", { invoiceId: MAX_DB_INTEGER_ID + 1 }],
    ["retenue négative", { withholdingIsAmount: -1 }],
    ["date de dépôt hors format", { depositedAt: "10/10/2026" }],
    ["compteur négatif", { daysSinceDeposit: -1 }],
    ["base IS inconnue", { withholdingIsBase: "tva" }],
  ])("refuse : %s", (_label, overrides) => {
    const r = invoicesAwaitingPaymentResponseSchema.safeParse({ items: [item(overrides)], totals });
    expect(r.success).toBe(false);
  });
});

describe("corps des routes finance F1", () => {
  it("dépôt : date AAAA-MM-JJ seule", () => {
    expect(invoiceDepositRequestSchema.safeParse({ depositedAt: "2026-11-05" }).success).toBe(true);
    expect(invoiceDepositRequestSchema.safeParse({ depositedAt: "05/11/2026" }).success).toBe(false);
    expect(invoiceDepositRequestSchema.safeParse({ depositedAt: "2026-11-05", netPayable: 1 }).success).toBe(false);
  });

  it.each([
    [{ vatWithholdingRate: 19.25, isWithholdingRate: 2.2, isBase: "ht" }, true],
    [{ vatWithholdingRate: null, isWithholdingRate: null, isBase: "ttc" }, true],
    [{ vatWithholdingRate: 101, isWithholdingRate: 2.2, isBase: "ht" }, false],
    [{ vatWithholdingRate: -1, isWithholdingRate: 2.2, isBase: "ht" }, false],
    [{ vatWithholdingRate: 19.255, isWithholdingRate: 2.2, isBase: "ht" }, false],
    [{ vatWithholdingRate: 19.25, isWithholdingRate: 2.2, isBase: "tva" }, false],
    [{ vatWithholdingRate: 19.25, isWithholdingRate: 2.2 }, false],
  ])("taux client %j → %s", (body, ok) => {
    expect(clientWithholdingRequestSchema.safeParse(body).success).toBe(ok);
  });
});
