import { describe, expect, it } from "vitest";
import { financeReceivablesAgingResponseSchema } from "../../../shared/contracts/finance-receivables-aging";
import type { InvoiceAwaitingPayment } from "../../../shared/contracts/invoices-awaiting-payment";
import { agingBucketOf, buildReceivablesAging } from "../../../shared/finance/receivables-aging";

function item(over: Partial<InvoiceAwaitingPayment>): InvoiceAwaitingPayment {
  return {
    invoiceId: 1,
    invoiceNumber: "F-1",
    clientId: 1,
    clientName: "Alpha",
    amountHt: 100,
    amountTtc: 119.25,
    withholdingVatAmount: 0,
    withholdingIsAmount: 0,
    netPayable: 119.25,
    withholdingIsBase: "ht",
    withholdingFrozen: true,
    depositedAt: "2026-01-01",
    daysSinceDeposit: 0,
    balanceDue: 119.25,
    ...over,
  };
}

describe("agingBucketOf", () => {
  it.each([
    [null, "notDeposited"],
    [0, "days0to30"],
    [30, "days0to30"],
    [31, "days31to60"],
    [60, "days31to60"],
    [61, "days61to90"],
    [90, "days61to90"],
    [91, "over90"],
    [4000, "over90"],
  ] as const)("%s jours : %s", (days, bucket) => {
    expect(agingBucketOf(days)).toBe(bucket);
  });
});

describe("buildReceivablesAging", () => {
  it("aucune facture : totaux à zéro, aucune ligne", () => {
    const r = financeReceivablesAgingResponseSchema.parse(buildReceivablesAging([], "2026-11-05"));
    expect(r.byClient).toEqual([]);
    expect(r.totals.total).toEqual({ count: 0, amountDue: 0, amountTtc: 0, netPayable: 0 });
  });

  it("sommes exactes en centimes, reste dû distinct du TTC, total = somme des tranches", () => {
    const items = [
      item({ amountTtc: 0.1, netPayable: 0.1, balanceDue: 0.05, daysSinceDeposit: 1 }),
      item({ amountTtc: 0.2, netPayable: 0.2, balanceDue: 0.2, daysSinceDeposit: 2 }),
      item({ amountTtc: 0.7, netPayable: 0.5, balanceDue: 0.7, daysSinceDeposit: null }),
    ];
    const r = buildReceivablesAging(items, "2026-11-05");
    expect(r.totals.days0to30).toEqual({ count: 2, amountDue: 0.25, amountTtc: 0.3, netPayable: 0.3 });
    expect(r.totals.notDeposited).toEqual({ count: 1, amountDue: 0.7, amountTtc: 0.7, netPayable: 0.5 });
    expect(r.totals.total).toEqual({ count: 3, amountDue: 0.95, amountTtc: 1, netPayable: 0.8 });
  });

  it("clients triés par nom, facture sans client en dernier", () => {
    const items = [
      item({ clientId: null, clientName: null }),
      item({ clientId: 2, clientName: "Zeta" }),
      item({ clientId: 3, clientName: "Éole" }),
      item({ clientId: 1, clientName: "Alpha", daysSinceDeposit: 120 }),
    ];
    const r = buildReceivablesAging(items, "2026-11-05");
    expect(r.byClient.map((c) => c.clientId)).toEqual([1, 3, 2, null]);
    expect(r.byClient[0].over90.count).toBe(1);
    expect(r.asOf).toBe("2026-11-05");
  });
});
