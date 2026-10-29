import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { threeWayMatchingService } from "../../server/services/three-way-matching-service";
import { supplierInvoices, supplierInvoiceSettlements } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser } from "../support/factories";

/**
 * T7 niveau I : un règlement fournisseur saisi deux fois (double clic, retry
 * réseau, onglet rejoué) ne doit pas faire payer la facture deux fois.
 *
 * Le contrôle « montant <= solde » lisait un solde qui ne baisse qu'au
 * rapprochement bancaire : les règlements saisis mais pas encore rapprochés
 * n'étaient pas comptés, et rien n'empêchait deux saisies simultanées.
 */

const ids = createIdBag();
// Total TTC de la facture de test (factory) : 119 250 FCFA.
const TOTAL = 119250;

afterAll(async () => {
  // Les règlements partent en cascade avec les factures.
  await cleanupCreated(ids);
});

async function setup() {
  const accountant = await createTestUser({ role: "secretary" });
  ids.userIds.push(accountant.id);
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  return { accountant, invoice };
}

function settlementInput(paymentReference: string, amount = TOTAL) {
  return {
    amount,
    paymentMethod: "virement",
    paymentReference,
    paymentDate: "2026-10-29",
    proofReference: "/uploads/supplier-invoices/settlements/TEST.pdf",
  };
}

async function settlementsOf(invoiceId: number) {
  return db.select().from(supplierInvoiceSettlements).where(eq(supplierInvoiceSettlements.supplierInvoiceId, invoiceId));
}

describe("Règlement fournisseur : double soumission", { timeout: 120000 }, () => {
  it("la même saisie rejouée renvoie le règlement existant, sans doublon", async () => {
    const { accountant, invoice } = await setup();

    const first = await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-1"));
    const replay = await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-1"));

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.settlement.id).toBe(first.settlement.id);
    expect(await settlementsOf(invoice.id)).toHaveLength(1);
  });

  it("deux saisies simultanées de la même référence n'enregistrent qu'un règlement", async () => {
    const { accountant, invoice } = await setup();

    const results = await Promise.all([
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-2")),
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-2")),
    ]);

    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await settlementsOf(invoice.id)).toHaveLength(1);
  });

  it("deux saisies simultanées de références différentes ne dépassent pas le total", async () => {
    const { accountant, invoice } = await setup();

    const results = await Promise.allSettled([
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-3A")),
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-3B")),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ name: "AppError", status: 409 });
    expect(await settlementsOf(invoice.id)).toHaveLength(1);
  });

  it("un règlement saisi non rapproché compte dans le reste à régler", async () => {
    const { accountant, invoice } = await setup();

    await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-4A", 100000));

    await expect(
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-4B", 20000)),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
    // Le complément exact reste accepté.
    const rest = await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-4C", TOTAL - 100000));
    expect(rest.replayed).toBe(false);
  });

  it("une référence déjà utilisée avec un autre montant est refusée", async () => {
    const { accountant, invoice } = await setup();

    await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-5", 50000));

    await expect(
      threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-5", 60000)),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
  });

  it("deux rapprochements simultanés du même règlement soldent la facture une fois, sans erreur", async () => {
    const { accountant, invoice } = await setup();
    const { settlement } = await threeWayMatchingService.recordInvoiceSettlement(invoice.id, accountant.id, settlementInput("TEST-VIR-6"));

    const results = await Promise.all([
      threeWayMatchingService.reconcileInvoiceSettlement(invoice.id, settlement.id, accountant.id),
      threeWayMatchingService.reconcileInvoiceSettlement(invoice.id, settlement.id, accountant.id),
    ]);

    expect(results.map((r) => r.settlement.status)).toEqual(["reconciled", "reconciled"]);
    const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(row.status).toBe("paid");
    expect(Number(row.balance)).toBe(0);
  });

  it("une facture non approuvée refuse le règlement en 409 lisible", async () => {
    const { accountant } = await setup();
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const draft = await createTestSupplierInvoice({ supplierId: supplier.id, status: "received" });
    ids.invoiceIds.push(draft.id);

    await expect(
      threeWayMatchingService.recordInvoiceSettlement(draft.id, accountant.id, settlementInput("TEST-VIR-7")),
    ).rejects.toMatchObject({ name: "AppError", status: 409 });
  });
});
