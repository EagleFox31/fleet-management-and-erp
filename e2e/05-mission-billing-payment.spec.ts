import { test, expect } from "@playwright/test";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestClientInvoice } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginAndOpen } from "./helpers/auth";

/**
 * Données propres à la spec : un client et une facture client en attente, créés sur la base
 * visée par le serveur (garde-fou production de playwright.config.ts) et supprimés en fin de
 * spec (paiements en cascade). Rejouable : identifiants uniques, nettoyage par id.
 */
const ids = createIdBag();
let invoiceId = 0;

test.beforeAll(async () => {
  const client = await createTestClient({ name: uniqueTestToken("E2E-05-CLIENT") });
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, invoiceNumber: uniqueTestToken("E2E-05-FACT"), status: "pending" });
  ids.clientInvoiceIds.push(invoice.id);
  invoiceId = invoice.id;
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

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

    await page.goto(`/operations/invoices/${invoiceId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("invoice-number-field")).toBeVisible();
    await expect(page.getByTestId("amount-ttc")).toBeVisible();

    await page.getByTestId("button-record-payment").click();
    await page.getByTestId("input-payment-amount").fill("1");
    await page.getByTestId("button-confirm-payment").click();

    await expect(page.getByTestId("payment-row-0")).toBeVisible();
  });
});
