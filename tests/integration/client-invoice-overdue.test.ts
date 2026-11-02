import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientBillingService } from "../../server/services/client-billing-service";
import { clientInvoices } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser } from "../support/factories";

/**
 * CINV2 niveau I : une facture client échue et non soldée passe d'elle-même
 * en `overdue`. Avant, rien ne posait ce statut : le compteur « en retard » des
 * statistiques restait à 0 quelle que soit l'échéance.
 */

const ids = createIdBag();
const AS_OF = "2026-11-01";
const TOTAL = 119250;

afterAll(async () => {
  await cleanupCreated(ids);
});

async function invoice(overrides: Partial<typeof clientInvoices.$inferInsert>) {
  if (ids.clientIds.length === 0) {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
  }
  const row = await createTestClientInvoice({ clientId: ids.clientIds[0], ...overrides });
  ids.clientInvoiceIds.push(row.id);
  return row;
}

async function statusesOf(invoiceIds: number[]) {
  const rows = await db.select().from(clientInvoices).where(inArray(clientInvoices.id, invoiceIds));
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

describe("Factures client : passage automatique en retard (CINV2)", { timeout: 120000 }, () => {
  it("seules les factures échues et non soldées passent en retard, un second passage n'écrit rien", async () => {
    const pendingLate = await invoice({ dueDate: "2026-10-31" });
    const partialLate = await invoice({ dueDate: "2026-09-30", status: "partial", balance: "50000.00" });
    const dueToday = await invoice({ dueDate: AS_OF });
    const future = await invoice({ dueDate: "2099-01-01" });
    const paid = await invoice({ dueDate: "2026-01-01", status: "paid", balance: "0.00" });
    const cancelled = await invoice({ dueDate: "2026-01-01", status: "cancelled" });
    const mine = [pendingLate, partialLate, dueToday, future, paid, cancelled].map((r) => r.id);

    // Périmètre limité aux factures du test : les autres suites tournent sur la
    // même base en parallèle, un passage global changerait leurs statuts.
    const first = await clientBillingService.markOverdueInvoices({ asOf: AS_OF, invoiceIds: mine });
    expect([...first].sort()).toEqual([pendingLate.id, partialLate.id].sort());
    expect(await statusesOf(mine)).toEqual({
      [pendingLate.id]: "overdue",
      [partialLate.id]: "overdue",
      [dueToday.id]: "pending",
      [future.id]: "pending",
      [paid.id]: "paid",
      [cancelled.id]: "cancelled",
    });

    const second = await clientBillingService.markOverdueInvoices({ asOf: AS_OF, invoiceIds: mine });
    expect(second).toEqual([]);
  });

  it("un paiement partiel garde la facture en retard, le solde complet la passe en payée", async () => {
    const accountant = await createTestUser({ role: "secretary" });
    ids.userIds.push(accountant.id);
    const late = await invoice({ dueDate: "2026-10-01" });
    expect(await clientBillingService.markOverdueInvoices({ asOf: AS_OF, invoiceIds: [late.id] })).toEqual([late.id]);

    const payment = (amount: number, reference: string) =>
      clientBillingService.recordPayment(late.id, {
        amount, paymentDate: AS_OF, paymentMethod: "bank_transfer", reference, userId: accountant.id,
      });

    expect((await payment(20000, `TEST-CINV2-${late.id}-1`)).status).toBe("overdue");
    expect((await statusesOf([late.id]))[late.id]).toBe("overdue");
    expect((await payment(TOTAL - 20000, `TEST-CINV2-${late.id}-2`)).status).toBe("paid");
  });
});
