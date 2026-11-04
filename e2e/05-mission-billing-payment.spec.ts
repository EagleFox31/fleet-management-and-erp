import { test, expect } from "@playwright/test";
import { loginAndOpen } from "./helpers/auth";

test.describe("Critical Journey 5 - Mission vers Facture vers Paiement", () => {
  test("operations + factures clients + enregistrement paiement", async ({ page }) => {
    await loginAndOpen(page, "/operations");

    // Cibler par data-testid: le titre affiche a deja change une fois
    // ("Dashboard Opérations" -> "Dashboard operations"), ce qui cassait la spec
    // sans que rien ne le signale. Meme lecon que le formulaire de login.
    await expect(page.getByTestId("page-header-operations")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Factures/ })).toBeVisible();

    await page.goto("/operations/invoices", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("stat-total-invoices")).toBeVisible();
    await expect(page.getByTestId("stat-pending")).toBeVisible();

    const invoicesResponse = await page.request.get("/api/billing/invoices");
    expect(invoicesResponse.ok()).toBeTruthy();

    const invoicesPayload = await invoicesResponse.json();
    expect(Array.isArray(invoicesPayload.invoices)).toBeTruthy();

    if (invoicesPayload.invoices.length === 0) {
      await expect(page.getByText("Aucune facture trouvée")).toBeVisible();
      test.skip(true, "Aucune facture client en base: detail et paiement non exerces.");
    }

    const invoiceId = invoicesPayload.invoices[0].id;
    await page.goto(`/operations/invoices/${invoiceId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("invoice-number-field")).toBeVisible();
    await expect(page.getByTestId("amount-ttc")).toBeVisible();

    const paymentButton = page.getByTestId("button-record-payment");
    if ((await paymentButton.count()) === 0 || !(await paymentButton.isVisible())) {
      await expect(page.getByTestId("invoice-status")).toBeVisible();
      test.skip(true, "Facture non payable (deja soldee ou annulee): enregistrement de paiement non exerce.");
    }

    await paymentButton.click();
    await page.getByTestId("input-payment-amount").fill("1");
    await page.getByTestId("button-confirm-payment").click();

    await expect(page.getByTestId("payment-row-0")).toBeVisible();
  });
});
