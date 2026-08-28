import { afterEach, describe, expect, it } from "vitest";
import { vatBillingService } from "../../server/services/vat-billing-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestPart,
  createTestSupplier,
  createTestSupplierInvoice,
} from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.partIds.length = 0;
  ids.supplierIds.length = 0;
  ids.invoiceIds.length = 0;
});

describe("VATBillingService", () => {
  it("getSupplierInvoicesWithPayments lit la facture factory", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const invoice = await createTestSupplierInvoice({
      supplierId: supplier.id,
      amountHT: "100000.00",
      vatAmount: "19250.00",
      totalTTC: "119250.00",
      balance: "119250.00",
    });
    ids.invoiceIds.push(invoice.id);

    const result = await vatBillingService.getSupplierInvoicesWithPayments(supplier.id);

    expect(result.supplier.id).toBe(supplier.id);
    expect(result.invoices.some((row) => row.id === invoice.id)).toBe(true);
    expect(result.summary.totalInvoices).toBeGreaterThanOrEqual(1);
    const created = result.invoices.find((row) => row.id === invoice.id);
    expect(created).toBeDefined();
    expect(["paid", "partial", "unpaid"]).toContain(created!.paymentStatus);
  });

  it("getPartsFromInvoice relie les pièces par numéro de BL", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const invoice = await createTestSupplierInvoice({ supplierId: supplier.id });
    ids.invoiceIds.push(invoice.id);
    const part = await createTestPart({
      deliveryReceiptNumber: invoice.invoiceNumber,
      supplierId: supplier.id,
    });
    ids.partIds.push(part.id);

    const result = await vatBillingService.getPartsFromInvoice(invoice.id);

    expect(result.invoice.id).toBe(invoice.id);
    expect(result.parts.some((row) => row.id === part.id)).toBe(true);
    expect(result.summary.partsCount).toBeGreaterThanOrEqual(1);
  });

  it("getMonthlyVATStats pour un mois sans nos factures reste cohérent", async () => {
    const result = await vatBillingService.getMonthlyVATStats(1999, 1);

    expect(result.year).toBe(1999);
    expect(result.month).toBe(1);
    expect(result.vatRate).toBe(19.25);
    expect(result.totalTTC).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.bySupplier)).toBe(true);
  });

  it("getTopSuppliers inclut le fournisseur factory quand il a une facture", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const invoice = await createTestSupplierInvoice({
      supplierId: supplier.id,
      amountHT: "999999.00",
      totalTTC: "1192499.00",
    });
    ids.invoiceIds.push(invoice.id);

    const result = await vatBillingService.getTopSuppliers(50);
    expect(result.some((row) => row.supplier.id === supplier.id)).toBe(true);
  });
});
