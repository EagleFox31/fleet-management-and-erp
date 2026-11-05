import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { clientInvoices, clientPayments } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_INVOICE, seedDemo } from "./seed-demo";

/**
 * Démo « paiement de facture » : la secrétaire ouvre la facture client en attente, enregistre un
 * acompte puis le solde ; la facture passe à « payée », solde nul.
 */
test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

async function invoiceState() {
  const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.invoiceNumber, DEMO_INVOICE.number));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, row.id));
  return { row, payments };
}

test("démo paiement : acompte puis solde d'une facture client", async ({ page }) => {
  test.setTimeout(120_000);
  const before = await invoiceState();
  expect(before.row.status).toBe("pending");
  expect(before.payments).toHaveLength(0);

  await loginThroughForm(page, DEMO_ACCOUNTS.secretary.username, DEMO_ACCOUNTS.secretary.password);
  await page.getByRole("link", { name: "Facturation client" }).first().click();
  await expect(page).toHaveURL(/\/operations/, { timeout: 30_000 });
  await page.getByTestId("tab-invoices").click();
  await page.getByRole("link", { name: "Voir les factures" }).click();
  await expect(page).toHaveURL(/\/operations\/invoices$/, { timeout: 30_000 });
  await page.getByTestId("input-search-invoices").fill(DEMO_INVOICE.number);
  await beat(page, 2000);
  await page.getByTestId(`button-view-invoice-${before.row.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/operations/invoices/${before.row.id}`), { timeout: 30_000 });
  await beat(page, 2500);

  const pay = async (amount: number, rowTestId: string) => {
    await page.getByTestId("button-record-payment").click();
    await page.getByTestId("input-payment-amount").fill(String(amount));
    await beat(page, 1500);
    await page.getByTestId("button-confirm-payment").click();
    await expect(page.getByTestId("input-payment-amount")).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId(rowTestId)).toBeVisible({ timeout: 30_000 });
    await beat(page, 2500);
  };

  await pay(DEMO_INVOICE.firstPayment, "payment-row-0");
  await expect.poll(async () => (await invoiceState()).row.status).toBe("partial");
  await pay(DEMO_INVOICE.amountTTC - DEMO_INVOICE.firstPayment, "payment-row-1");

  await expect.poll(async () => (await invoiceState()).row.status, { timeout: 15_000 }).toBe("paid");
  const after = await invoiceState();
  expect(Number(after.row.balance)).toBe(0);
  expect(after.payments).toHaveLength(2);
  await beat(page, 2000);
});
