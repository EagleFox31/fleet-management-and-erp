import { expect, test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { clientInvoices, clientPayments, parts, partsStockMovements } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestClientInvoice, createTestPart } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Priorité 1 du plan de couverture, niveau E :
 * - T7 : un double clic ou une saisie rejouée depuis l'écran n'enregistre qu'un
 *   paiement, et un double clic sur l'ajustement de stock ne l'applique qu'une fois ;
 * - T1 : une requête forgée depuis la session d'un rôle sans droit est refusée (403)
 *   par le vrai serveur, et le solde ne bouge pas.
 *
 * Les niveaux U, I et C couvrent les règles ; ici on vérifie que l'écran et le
 * serveur réel les respectent ensemble. La vérité est lue en base, pas à l'écran.
 */

const TOTAL = 119250;
const ids = createIdBag();
let secretary: E2ECredentials;
let logistics: E2ECredentials;
let warehouse: E2ECredentials;

async function newInvoice() {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

async function stateOf(invoiceId: number) {
  const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { balance: Number(invoice.balance), payments };
}

async function openPaymentDialog(page: Page, amount: string, reference?: string) {
  await page.getByTestId("button-record-payment").click();
  await page.getByTestId("input-payment-amount").fill(amount);
  if (reference) {
    await page.getByTestId("input-payment-reference").fill(reference);
  }
}

test.beforeAll(async () => {
  secretary = await createE2EUser("secretary", ids);
  logistics = await createE2EUser("logistics", ids);
  warehouse = await createE2EUser("warehouse", ids);
});

test.afterAll(async () => {
  // Les paiements partent en cascade avec les factures ; les mouvements de stock non.
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

test.describe("Encaissement client : intégrité bout en bout", () => {
  test("T7 : un double clic sur Enregistrer n'enregistre qu'un paiement", async ({ page }) => {
    const invoice = await newInvoice();
    await loginWithSession(page, secretary);
    await page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });

    await openPaymentDialog(page, "1000");
    await page.getByTestId("button-confirm-payment").dblclick();

    await expect(page.getByTestId("payment-row-0")).toBeVisible();
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(state.balance).toBe(TOTAL - 1000);
    await expect(page.getByTestId("payment-row-1")).toHaveCount(0);
  });

  test("T7 : la même référence saisie deux fois n'est déduite qu'une fois", async ({ page }) => {
    const invoice = await newInvoice();
    const reference = uniqueTestToken("ref");
    await loginWithSession(page, secretary);
    await page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });

    for (let attempt = 0; attempt < 2; attempt++) {
      await openPaymentDialog(page, "2500", reference);
      await page.getByTestId("button-confirm-payment").click();
      await expect(page.getByTestId("input-payment-amount")).toBeHidden();
    }

    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0].reference).toBe(reference);
    expect(state.balance).toBe(TOTAL - 2500);
    await expect(page.getByTestId("payment-row-0")).toBeVisible();
    await expect(page.getByTestId("payment-row-1")).toHaveCount(0);
  });

  test("T1 : un paiement forgé depuis la session logistique est refusé, solde intact", async ({ page }) => {
    const invoice = await newInvoice();
    await loginWithSession(page, logistics);

    const response = await page.request.post(`/api/billing/invoices/${invoice.id}/payments`, {
      data: { amount: 1000, paymentDate: "2026-10-29", paymentMethod: "cash" },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ code: "FORBIDDEN" });
    expect(body.requestId).toBe(response.headers()["x-request-id"]);
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(0);
    expect(state.balance).toBe(TOTAL);
  });
});

test.describe("Ajustement de stock : intégrité bout en bout", () => {
  test("T7 : un double clic sur l'ajustement ne l'applique qu'une fois", async ({ page }) => {
    const part = await createTestPart({ quantity: 10 });
    ids.partIds.push(part.id);
    await loginWithSession(page, warehouse);
    await page.goto("/inventory", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Rechercher une pièce...").fill(part.reference);

    await page.getByTestId(`btn-adjust-stock-${part.id}`).click();
    await page.getByTestId("input-stock-adjustment").fill("3");
    await page.getByTestId("button-confirm-stock-adjustment").dblclick();
    await expect(page.getByTestId("input-stock-adjustment")).toBeHidden();

    const [row] = await db.select().from(parts).where(eq(parts.id, part.id));
    const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
    expect(movements).toHaveLength(1);
    expect(row.quantity).toBe(13);
  });
});
