import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientBillingService } from "../../server/services/client-billing-service";
import { clientInvoices, clientPayments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser } from "../support/factories";

/**
 * T7 niveau I : un encaissement client saisi deux fois (retry réseau, deux
 * onglets) ne doit ni compter deux fois ni perdre un paiement.
 *
 * Le service lisait le solde, puis l'écrivait et insérait le paiement sans
 * transaction ni verrou : deux paiements simultanés lisaient le même solde,
 * et le second écrasait le premier.
 */

const ids = createIdBag();
// Total TTC de la facture de test (factory) : 119 250 FCFA.
const TOTAL = 119250;

afterAll(async () => {
  // Les paiements partent en cascade avec les factures.
  await cleanupCreated(ids);
});

async function setup(status: "pending" | "cancelled" = "pending") {
  const accountant = await createTestUser({ role: "secretary" });
  ids.userIds.push(accountant.id);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, status });
  ids.clientInvoiceIds.push(invoice.id);
  return { accountant, invoice };
}

function paymentInput(userId: number, amount = TOTAL, reference?: string) {
  return { amount, paymentDate: "2026-10-29", paymentMethod: "bank_transfer", reference, userId };
}

async function stateOf(invoiceId: number) {
  const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { balance: Number(invoice.balance), status: invoice.status, payments };
}

describe("Encaissement client : double soumission", { timeout: 120000 }, () => {
  it("la même saisie rejouée renvoie le paiement existant, le solde ne baisse qu'une fois", async () => {
    const { accountant, invoice } = await setup();

    const first = await clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 50000, "TEST-CHQ-1"));
    const replay = await clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 50000, "TEST-CHQ-1"));

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(state.balance).toBe(TOTAL - 50000);
    expect(state.status).toBe("partial");
  });

  it("deux saisies simultanées de la même référence n'enregistrent qu'un paiement", async () => {
    const { accountant, invoice } = await setup();

    const results = await Promise.all([
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 50000, "TEST-CHQ-2")),
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 50000, "TEST-CHQ-2")),
    ]);

    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(state.balance).toBe(TOTAL - 50000);
  });

  it("deux paiements partiels simultanés sont tous deux comptés dans le solde", async () => {
    const { accountant, invoice } = await setup();

    await Promise.all([
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 40000)),
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 30000)),
    ]);

    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(2);
    expect(state.balance).toBe(TOTAL - 70000);
  });

  it("deux paiements du total en simultané : un accepté, l'autre refusé en 409", async () => {
    const { accountant, invoice } = await setup();

    const results = await Promise.allSettled([
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, TOTAL, "TEST-VIR-A")),
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, TOTAL, "TEST-VIR-B")),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ name: "AppError", status: 409 });
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(state.balance).toBe(0);
    expect(state.status).toBe("paid");
  });

  it("un paiement supérieur au solde restant est refusé", async () => {
    const { accountant, invoice } = await setup();

    await expect(
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, TOTAL + 1)),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
    expect((await stateOf(invoice.id)).payments).toHaveLength(0);
  });

  it("une référence déjà utilisée avec un autre montant est refusée", async () => {
    const { accountant, invoice } = await setup();

    await clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 50000, "TEST-CHQ-3"));

    await expect(
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 60000, "TEST-CHQ-3")),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
  });

  it("une facture annulée refuse le paiement", async () => {
    const { accountant, invoice } = await setup("cancelled");

    await expect(
      clientBillingService.recordPayment(invoice.id, paymentInput(accountant.id, 10000)),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
  });

  it("une facture inconnue renvoie 404", async () => {
    const { accountant } = await setup();

    await expect(
      clientBillingService.recordPayment(2147483000, paymentInput(accountant.id, 10000)),
    ).rejects.toMatchObject({ name: "AppError", status: 404 });
  });
});
