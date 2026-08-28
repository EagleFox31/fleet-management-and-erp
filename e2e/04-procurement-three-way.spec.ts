import { test, expect } from "@playwright/test";
import { loginAndOpen } from "./helpers/auth";

test.describe("Critical Journey 4 - Procurement 3-way", () => {
  test("vue ecarts + navigation vers facture fournisseur", async ({ page }) => {
    await loginAndOpen(page, "/procurement/invoices/discrepancies");

    await expect(page.getByRole("heading", { name: "Écarts à Traiter" })).toBeVisible();
    await expect(page.getByTestId("stat-discrepancy-count")).toBeVisible();
    await expect(page.getByTestId("stat-total-variance")).toBeVisible();

    const discrepanciesResponse = await page.request.get("/api/supplier-invoices/discrepancies");
    expect(discrepanciesResponse.ok()).toBeTruthy();

    const discrepanciesPayload = await discrepanciesResponse.json();
    expect(Array.isArray(discrepanciesPayload.discrepancies)).toBeTruthy();

    if (discrepanciesPayload.discrepancies.length === 0) {
      await expect(page.getByText("Aucun écart à traiter")).toBeVisible();
      test.skip(true, "Aucun ecart en base: navigation vers le detail facture non exercee.");
    }

    const firstInvoiceId = discrepanciesPayload.discrepancies[0].id;
    await page.getByTestId(`button-view-${firstInvoiceId}`).click();

    await expect(page).toHaveURL(new RegExp(`/procurement/invoices/${firstInvoiceId}$`));
    await expect(page.getByTestId("invoice-number")).toBeVisible();
  });
});
