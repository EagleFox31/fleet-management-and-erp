import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { supplierInvoices, supplierInvoiceSettlements } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTING, DEMO_ACCOUNTS, seedDemo } from "./seed-demo";

/**
 * Démo « comptable » : la comptable lit son tableau de bord, règle la facture fournisseur
 * approuvée (justificatif joint), la rapproche, puis parcourt la facturation client, le
 * carburant (lecture seule) et les rapports. Elle ne saisit rien d'opérationnel : ordre de
 * travail, fiche pièce, mission et plein lui sont refusés (403).
 *
 * Tuiles « À encaisser » et « À facturer » : drapeaux `finance` et `pending-invoices`
 * (FEATURE_FLAGS=finance=on,pending-invoices=on sur le serveur), voir e2e/demo/README.md.
 */
const PROOF = join(process.cwd(), "e2e/demo/fixtures/attestation-demo.pdf");
const PAYMENT_REFERENCE = "VIR-DEMO-0001";
const money = (amount: number) => new RegExp(String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s?"));

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

async function invoiceState() {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, DEMO_ACCOUNTING.invoiceToPay));
  const settlements = await db.select().from(supplierInvoiceSettlements).where(eq(supplierInvoiceSettlements.supplierInvoiceId, row.id));
  return { row, settlements };
}

test("démo comptable : régler une facture fournisseur, suivre l'argent, sans saisie opérationnelle", async ({ page }) => {
  test.setTimeout(240_000);
  const before = await invoiceState();
  expect(before.row.status).toBe("approved");
  expect(before.settlements).toHaveLength(0);

  await loginThroughForm(page, DEMO_ACCOUNTS.accountant.username, DEMO_ACCOUNTS.accountant.password);
  await expect(page.getByTestId("accountant-kpi-supplier-balance")).toContainText(money(DEMO_ACCOUNTING.amountTTC), { timeout: 30_000 });
  await expect(page.getByTestId("accountant-kpi-receivables")).toContainText(/\d+ factures? en attente/, { timeout: 30_000 });
  await beat(page, 2500);

  // Facture fournisseur approuvée : règlement saisi avec justificatif, puis rapproché.
  await page.getByRole("link", { name: "Factures fournisseur", exact: true }).first().click();
  await expect(page).toHaveURL(/\/procurement\/invoices$/, { timeout: 30_000 });
  await page.getByTestId("input-search-invoices").fill(DEMO_ACCOUNTING.invoiceToPay);
  await beat(page, 1500);
  await page.getByTestId(`button-view-invoice-${before.row.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/procurement/invoices/${before.row.id}$`), { timeout: 30_000 });
  await beat(page, 2000);

  await page.getByTestId("button-record-payment").first().click();
  await expect(page.getByTestId("input-payment-amount")).toHaveValue(money(DEMO_ACCOUNTING.amountTTC));
  await page.getByTestId("input-payment-reference").fill(PAYMENT_REFERENCE);
  await page.getByTestId("input-treasury-account").fill("Compte bancaire principal");
  await page.getByTestId("input-proof-file").setInputFiles(PROOF);
  await beat(page, 1500);
  await page.getByTestId("button-confirm-payment").click();
  await expect(page.getByTestId("input-payment-amount")).toBeHidden({ timeout: 30_000 });
  await beat(page, 2000);

  const reconcile = page.locator('[data-testid^="button-reconcile-settlement-"]').first();
  await expect(reconcile).toBeVisible({ timeout: 30_000 });
  await reconcile.click();
  await expect(page.getByText("Payée").first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 2500);

  await expect.poll(async () => (await invoiceState()).row.status, { timeout: 15_000 }).toBe("paid");
  const after = await invoiceState();
  expect(Number(after.row.balance)).toBe(0);
  expect(after.settlements).toHaveLength(1);
  expect(after.settlements[0]).toMatchObject({ status: "reconciled", paymentReference: PAYMENT_REFERENCE });

  // Facturation client : lecture des factures émises.
  await page.getByRole("link", { name: "Facturation client" }).first().click();
  await expect(page).toHaveURL(/\/operations/, { timeout: 30_000 });
  await page.getByTestId("tab-invoices").click();
  await page.getByRole("link", { name: "Voir les factures" }).click();
  await expect(page).toHaveURL(/\/operations\/invoices$/, { timeout: 30_000 });
  await beat(page, 2500);

  // Carburant : solde visible, aucun bouton de saisie de plein.
  await page.getByRole("link", { name: "Carburant", exact: true }).first().click();
  await expect(page).toHaveURL(/\/fuel/, { timeout: 30_000 });
  await beat(page, 2500);
  await expect(page.getByTestId("button-open-fuel-form")).toHaveCount(0);

  await page.goto("/reports");
  await expect(page.getByText("Exports et rapports").first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 2000);

  // Rien d'opérationnel : la garde serveur refuse avant toute validation du corps.
  for (const path of ["/api/work-orders", "/api/parts", "/api/missions", "/api/fuel-card/consumption", "/api/fuel-records"]) {
    const response = await page.request.post(path, { data: {} });
    expect(response.status(), `POST ${path}`).toBe(403);
  }
});
