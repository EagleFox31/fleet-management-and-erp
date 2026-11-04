import { test, expect } from "@playwright/test";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestSupplier, createTestSupplierInvoice } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginAndOpen } from "./helpers/auth";

/**
 * Données propres à la spec : une facture fournisseur en écart (> 5 %), créée sur la base
 * visée par le serveur (garde-fou production de playwright.config.ts) et supprimée en fin
 * de spec. Rejouable : identifiants uniques, nettoyage par id, rien d'autre n'est lu.
 */
const ids = createIdBag();
let invoiceId = 0;
let invoiceNumber = "";

test.beforeAll(async () => {
  const supplier = await createTestSupplier({ name: uniqueTestToken("E2E-04-FOURNISSEUR") });
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({
    supplierId: supplier.id,
    invoiceNumber: uniqueTestToken("E2E-04-FACT"),
    status: "received",
    hasDiscrepancy: true,
    priceVariance: "12000.00",
    variancePercentage: "12.00",
  });
  ids.invoiceIds.push(invoice.id);
  invoiceId = invoice.id;
  invoiceNumber = invoice.invoiceNumber;
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

test.describe("Critical Journey 4 - Procurement 3-way", () => {
  test("vue ecarts + navigation vers facture fournisseur", async ({ page }) => {
    await loginAndOpen(page, "/procurement/invoices/discrepancies");

    await expect(page.getByRole("heading", { name: "Écarts à Traiter" })).toBeVisible();
    await expect(page.getByTestId("stat-discrepancy-count")).toBeVisible();
    await expect(page.getByTestId("stat-total-variance")).toBeVisible();

    const discrepanciesResponse = await page.request.get("/api/supplier-invoices/discrepancies");
    expect(discrepanciesResponse.ok()).toBeTruthy();
    const discrepanciesPayload = await discrepanciesResponse.json();
    expect(discrepanciesPayload.discrepancies.map((d: { id: number }) => d.id)).toContain(invoiceId);

    await expect(page.getByTestId(`invoice-number-${invoiceId}`)).toHaveText(invoiceNumber);
    await page.getByTestId(`button-view-${invoiceId}`).click();

    await expect(page).toHaveURL(new RegExp(`/procurement/invoices/${invoiceId}$`));
    await expect(page.getByTestId("invoice-number")).toBeVisible();
  });
});
