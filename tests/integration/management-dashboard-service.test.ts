import { afterEach, describe, expect, it } from "vitest";
import { supplierInvoices } from "../../shared/schema";
import { db } from "../../server/db";
import { managementDashboardService } from "../../server/services/management-dashboard-service";
import { toIsoDateOnly } from "@shared/constants/management-dashboard";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestClient,
  createTestClientInvoice,
  createTestSupplier,
} from "../support/factories";
import { uniqueTestToken } from "../support/ids";

const ids = createIdBag();

// La période "month" va du 1er à aujourd'hui : un jour fixe (15, 16) sort de la
// période du 1er au 14 du mois et le test échoue selon la date du jour.
function currentMonthInvoiceDate(day = 15): string {
  const now = new Date();
  return toIsoDateOnly(new Date(now.getFullYear(), now.getMonth(), Math.min(day, now.getDate())));
}

afterEach(async () => {
  await cleanupCreated(ids);
  ids.supplierIds.length = 0;
  ids.invoiceIds.length = 0;
  ids.clientIds.length = 0;
  ids.clientInvoiceIds.length = 0;
});

describe("ManagementDashboardService", () => {
  it("agrège le CA HT client (pas TTC) sur la période mois", async () => {
    const before = await managementDashboardService.getDashboard("month");

    const client = await createTestClient();
    ids.clientIds.push(client.id);

    const invoice = await createTestClientInvoice({
      clientId: client.id,
      invoiceDate: currentMonthInvoiceDate(),
      dueDate: currentMonthInvoiceDate(28),
      amountHT: "250000.00",
      amountTTC: "298125.00",
      balance: "298125.00",
    });
    ids.clientInvoiceIds.push(invoice.id);

    const after = await managementDashboardService.getDashboard("month");

    expect(after.revenue.invoicedHT - before.revenue.invoicedHT).toBe(250_000);
    expect(after.revenue.invoicedTTC - before.revenue.invoicedTTC).toBe(298_125);
    expect(after.expenses.suppliers - before.expenses.suppliers).toBe(0);
  }, 30_000);

  it("agrège les charges fournisseurs en HT sur un import groupé", async () => {
    const invoiceDate = currentMonthInvoiceDate(16);
    const before = await managementDashboardService.getDashboard("month");

    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);

    const bulkToken = uniqueTestToken("bulk-sup");
    const inserted = await db
      .insert(supplierInvoices)
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          supplierId: supplier.id,
          invoiceNumber: `${bulkToken}-${index}`,
          invoiceDate,
          amountHT: "10000.00",
          vatAmount: "1925.00",
          totalTTC: "11925.00",
          totalAmount: "11925.00",
          subtotal: "10000.00",
          taxAmount: "1925.00",
          balance: "11925.00",
          status: "received" as const,
        })),
      )
      .returning({ id: supplierInvoices.id });

    ids.invoiceIds.push(...inserted.map((row) => row.id));

    const after = await managementDashboardService.getDashboard("month");

    expect(after.expenses.suppliers - before.expenses.suppliers).toBe(50_000);
    expect(after.result.grossHT - before.result.grossHT).toBe(-50_000);
  }, 30_000);
});
