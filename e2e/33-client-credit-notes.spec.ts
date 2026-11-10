import { expect, test, type Browser } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { clientCreditNotes, clientInvoices } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestClientInvoice } from "../tests/support/factories";
import { deleteClientCreditNotesWhere, deleteClientInvoicesForTest } from "../tests/support/money-override";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";
import { createE2EUser } from "./helpers/test-data";

/**
 * V1, PR6 : avoirs sur la facture client, à l'écran.
 * Le comptable émet un avoir depuis le détail de facture ; la secrétaire, sur la même facture, le voit
 * arriver par la trame `client_credit_note_created` (deux rôles, AGENTS.md §3). Vérité lue en base.
 * Données créées ici (client, factures, comptes) et supprimées en fin de spec.
 */

const ids = createIdBag();
const invoiceIds: number[] = [];
let accountant: E2ECredentials;
let secretary: E2ECredentials;

async function openSession(browser: Browser, credentials: E2ECredentials) {
  const context = await newE2EContext(browser, credentials.label);
  const page = await context.newPage();
  await loginWithSession(page, credentials);
  return { context, page };
}

/** Facture de 100 000 HT (119 250 TTC, TVA 19,25 %), émise pour un client de test. */
async function newInvoice(overrides: Partial<typeof clientInvoices.$inferInsert> = {}) {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, vatRate: "19.25", ...overrides });
  invoiceIds.push(invoice.id);
  return invoice;
}

async function stateOf(invoiceId: number) {
  const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const notes = await db.select().from(clientCreditNotes).where(eq(clientCreditNotes.invoiceId, invoiceId));
  return { row, notes };
}

test.beforeAll(async () => {
  accountant = await createE2EUser("accountant", ids);
  secretary = await createE2EUser("secretary", ids);
});

test.afterAll(async () => {
  if (invoiceIds.length > 0) {
    await deleteClientCreditNotesWhere(inArray(clientCreditNotes.invoiceId, invoiceIds));
    await deleteClientInvoicesForTest(invoiceIds);
  }
  await cleanupCreated(ids);
});

test.describe("avoirs client à l'écran", () => {
  test("le comptable émet un avoir (double clic = un seul avoir), la secrétaire le voit sans recharger", async ({ browser }) => {
    test.setTimeout(180_000);
    const invoice = await newInvoice();
    const acc = await openSession(browser, accountant);
    const sec = await openSession(browser, secretary);
    const frames: string[] = [];
    sec.page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      socket.on("framereceived", (frame) => frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString()));
    });
    try {
      await sec.page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });
      await expect(sec.page.getByTestId("no-credit-notes-message")).toBeVisible({ timeout: 60_000 });
      // La secrétaire encaisse mais n'émet pas d'avoir : pas de bouton.
      await expect(sec.page.getByTestId("button-issue-credit-note")).toHaveCount(0);
      await expect
        .poll(() => frames.some((f) => f.includes("auth_success")), { message: "socket /ws de la secrétaire non ouverte", timeout: 60_000 })
        .toBe(true);

      await acc.page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });
      await acc.page.getByTestId("button-issue-credit-note").click({ timeout: 60_000 });
      await acc.page.getByTestId("input-credit-note-amount").fill("10 000");
      await expect(acc.page.getByTestId("credit-note-preview")).toContainText("11");
      await acc.page.getByTestId("input-credit-note-reason").fill("Remise commerciale E2E");
      // Double clic : useSingleFlightMutate + requestKey, un seul avoir attendu en base.
      await acc.page.getByTestId("button-confirm-credit-note").dblclick();
      await expect(acc.page.locator('[data-testid^="credit-note-row-"]')).toHaveCount(1, { timeout: 30_000 });
      await expect(acc.page.getByTestId("amount-credited")).toBeVisible();

      const { row, notes } = await stateOf(invoice.id);
      expect(notes).toHaveLength(1);
      expect(Number(notes[0].amountTTC)).toBe(11925);
      expect(Number(row.balance)).toBe(119250 - 11925);
      expect(Number(row.creditedAmountTtc)).toBe(11925);
      expect(row.status).toBe("partial");

      // Côté secrétaire : la trame arrive et la ligne apparaît sans rechargement.
      await expect
        .poll(() => frames.some((f) => f.includes("client_credit_note_created") && f.includes(notes[0].creditNoteNumber)), {
          message: "trame client_credit_note_created absente côté secrétaire",
          timeout: 15_000,
        })
        .toBe(true);
      await expect(sec.page.getByTestId(`credit-note-row-${notes[0].id}`)).toBeVisible({ timeout: 5_000 });
    } finally {
      await acc.context.close();
      await sec.context.close();
    }
  });

  test("« Tout le solde » solde la facture par avoir, puis le bouton se ferme avec la raison", async ({ browser }) => {
    test.setTimeout(120_000);
    const invoice = await newInvoice();
    const acc = await openSession(browser, accountant);
    try {
      await acc.page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });
      await acc.page.getByTestId("button-issue-credit-note").click({ timeout: 60_000 });
      await acc.page.getByTestId("button-credit-note-max").click();
      await expect(acc.page.getByTestId("input-credit-note-amount")).toHaveValue("100000.00");
      await acc.page.getByTestId("input-credit-note-reason").fill("Prestation annulée E2E");
      await acc.page.getByTestId("button-confirm-credit-note").click();
      await expect(acc.page.getByTestId("invoice-status")).toHaveText("Payée", { timeout: 30_000 });
      const button = acc.page.getByTestId("button-issue-credit-note");
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("title", /soldée/);

      const { row, notes } = await stateOf(invoice.id);
      expect(notes).toHaveLength(1);
      expect(Number(row.balance)).toBe(0);
      expect(row.status).toBe("paid");
    } finally {
      await acc.context.close();
    }
  });

  test("facture déposée : bouton fermé, avec la raison du serveur", async ({ browser }) => {
    test.setTimeout(120_000);
    const invoice = await newInvoice({ depositedAt: "2026-11-01" });
    const acc = await openSession(browser, accountant);
    try {
      await acc.page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });
      const button = acc.page.getByTestId("button-issue-credit-note");
      await expect(button).toBeDisabled({ timeout: 60_000 });
      await expect(button).toHaveAttribute("title", /déposée/);
      expect((await stateOf(invoice.id)).notes).toHaveLength(0);
    } finally {
      await acc.context.close();
    }
  });
});
