import { expect, test, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { codeForStatus } from "../shared/errors";
import { clientInvoices, clientPayments, missions } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * MIS1 et P2, niveau E : une mission créée par la logistique est facturée depuis
 * son écran, puis encaissée en deux fois par la secrétaire.
 *
 * Contrairement à `05-mission-billing-payment`, qui lit la première facture
 * trouvée et skippe sur base vide, cette spec crée toutes ses données et les
 * supprime. La vérité est lue en base.
 *
 * Second describe (P2) : état de la facture sur l'écran mission suivi en temps réel (trame
 * `client_invoice_payment_recorded`, deux rôles), rôles du paiement, trop-perçu et corps invalides.
 *
 * Limite assumée : le lancement d'une mission exige affectation, documents du
 * véhicule et CPC du chauffeur (`PUT /api/missions/:id/status`). Ce parcours ne
 * le rejoue pas : la mission est créée par l'API puis posée à « livrée » en
 * base, état à partir duquel l'écran autorise la facturation. Le lancement est
 * rejoué au navigateur par `17-mission-lifecycle`.
 */

const HT = 100000;
const TTC = 119250; // TVA 19,25 %
const ids = createIdBag();

/** Détail technique interdit dans une réponse d'erreur (AGENTS.md §10, même filtre que PRT1). */
const TECHNICAL = /SQLSTATE|violates|duplicate key|invalid input syntax|foreign key|constraint|at \S+:\d+|ZodError|"path":|\binvalid_type\b/i;

/** Corps conforme à ApiErrorBody : statut attendu, code du statut, message lisible, rien de technique. */
function expectApiError(status: number, text: string, expected: number, label: string) {
  expect(status, `${label} : ${text}`).toBe(expected);
  const body = JSON.parse(text) as { message?: unknown; code?: unknown };
  expect(typeof body.message, label).toBe("string");
  expect(String(body.message).length, label).toBeGreaterThan(0);
  expect(body.code, label).toBe(codeForStatus(expected));
  expect(text, label).not.toMatch(TECHNICAL);
}
const missionIds: number[] = [];
let logistics: E2ECredentials;
let secretary: E2ECredentials;

test.beforeAll(async () => {
  logistics = await createE2EUser("logistics", ids);
  secretary = await createE2EUser("secretary", ids);
});

test.afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(clientInvoices).where(inArray(clientInvoices.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
});

test.describe("Mission vers facture vers paiement : parcours complet", () => {
  test("P2 : facture générée depuis la mission, payée en deux fois, soldée", async ({ browser }) => {
    test.setTimeout(240_000);
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const logisticsContext = await browser.newContext();
    const secretaryContext = await browser.newContext();

    try {
      const logisticsPage = await logisticsContext.newPage();
      await loginWithSession(logisticsPage, logistics);

      // MIS1 : création par l'API avec la session de la logistique.
      const created = await logisticsPage.request.post("/api/missions", {
        data: {
          orderNumber: uniqueTestToken("mis"),
          clientId: client.id,
          pickupAddress: "Douala",
          deliveryAddress: "Yaoundé",
        },
      });
      expect(created.status(), await created.text()).toBeLessThan(300);
      const mission = await created.json();
      missionIds.push(mission.id);
      await db.update(missions).set({ status: "delivered" }).where(eq(missions.id, mission.id));

      // Facturation depuis l'écran mission.
      await logisticsPage.goto(`/missions/${mission.id}`, { waitUntil: "domcontentloaded" });
      await expect(logisticsPage.getByTestId("button-open-generate-invoice-dialog")).toBeEnabled();
      await logisticsPage.getByTestId("button-open-generate-invoice-dialog").click();
      await logisticsPage.getByTestId("input-amount").fill(String(HT));
      await logisticsPage.getByTestId("input-due-date").fill("2099-12-31");
      await expect(logisticsPage.getByTestId("preview-ttc")).toContainText("119");
      await logisticsPage.getByTestId("button-submit-invoice").click();
      await expect(logisticsPage).toHaveURL(/\/operations\/invoices\/\d+$/);

      const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, mission.id));
      expect(invoice, "facture créée pour la mission").toBeTruthy();
      expect(Number(invoice.amountHT)).toBe(HT);
      expect(Number(invoice.amountTTC)).toBe(TTC);
      expect(Number(invoice.balance)).toBe(TTC);
      expect(invoice.clientId).toBe(client.id);

      // La logistique voit la facture mais ne peut pas encaisser.
      await expect(logisticsPage.getByTestId("button-record-payment")).toBeDisabled();

      // Encaissement par la secrétaire, en deux fois.
      const secretaryPage = await secretaryContext.newPage();
      await loginWithSession(secretaryPage, secretary);
      await secretaryPage.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });

      const pay = async (amount: number) => {
        await secretaryPage.getByTestId("button-record-payment").click();
        await secretaryPage.getByTestId("input-payment-amount").fill(String(amount));
        await secretaryPage.getByTestId("button-confirm-payment").click();
        await expect(secretaryPage.getByTestId("input-payment-amount")).toBeHidden();
      };
      const state = async () => {
        const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoice.id));
        const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoice.id));
        return { row, payments };
      };

      await pay(50000);
      await expect(secretaryPage.getByTestId("payment-row-0")).toBeVisible();
      let s = await state();
      expect(s.payments).toHaveLength(1);
      expect(Number(s.row.balance)).toBe(TTC - 50000);
      expect(s.row.status).not.toBe("paid");

      await pay(TTC - 50000);
      await expect(secretaryPage.getByTestId("payment-row-1")).toBeVisible();
      s = await state();
      expect(s.payments).toHaveLength(2);
      expect(Number(s.row.balance)).toBe(0);
      expect(s.row.status).toBe("paid");
      await expect(secretaryPage.getByTestId("button-record-payment")).toHaveCount(0);
    } finally {
      await logisticsContext.close();
      await secretaryContext.close();
    }
  });
});

type InvoiceRow = typeof clientInvoices.$inferSelect;

async function balanceOf(invoiceId: number): Promise<{ row: InvoiceRow; payments: number }> {
  const [row] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { row, payments: payments.length };
}

async function openSession(browser: Browser, credentials: E2ECredentials) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginWithSession(page, credentials);
  return { context, page };
}

/** Mission livrée d'un nouveau client, puis facture générée par l'API avec la session logistique. */
async function deliveredMissionWithInvoice(api: APIRequestContext): Promise<{ missionId: number; invoiceId: number }> {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber: uniqueTestToken("mis"), status: "delivered", pickupAddress: "Douala", deliveryAddress: "Yaoundé" })
    .returning();
  missionIds.push(mission.id);
  const res = await api.post("/api/billing/invoices/generate", {
    data: { missionId: mission.id, amount: HT, dueDate: "2099-12-31" },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { invoice?: { id: number }; id?: number };
  return { missionId: mission.id, invoiceId: (body.invoice?.id ?? body.id) as number };
}

const payment = (amount: number | string, extra: Record<string, unknown> = {}) => ({
  data: { amount, paymentDate: "2026-11-03", paymentMethod: "bank_transfer", ...extra },
});

test.describe("P2 : état de la facture sur la mission et rôles du paiement", () => {
  test("la mission montre la facture en attente, partielle puis payée, sans rechargement", async ({ browser }) => {
    test.setTimeout(240_000);
    const logisticsSession = await openSession(browser, logistics);
    const frames: string[] = [];
    logisticsSession.page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      socket.on("framereceived", (frame) => frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString()));
    });
    const secretarySession = await openSession(browser, secretary);
    try {
      const { missionId, invoiceId } = await deliveredMissionWithInvoice(logisticsSession.page.request);
      await logisticsSession.page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
      await logisticsSession.page.getByRole("tab", { name: /Factures/ }).click();
      const card = logisticsSession.page.getByTestId(`invoice-${invoiceId}`);
      await expect(card).toContainText("En attente", { timeout: 60_000 });
      await expect
        .poll(() => frames.some((f) => f.includes("auth_success")), { message: "socket /ws de la logistique non ouverte", timeout: 60_000 })
        .toBe(true);

      // Paiement partiel par la secrétaire : la trame arrive à la logistique, l'écran suit sans recharger.
      const partial = await secretarySession.page.request.post(`/api/billing/invoices/${invoiceId}/payments`, payment(50000, { reference: uniqueTestToken("ref") }));
      expect(partial.status(), await partial.text()).toBe(200);
      const frameOfInvoice = new RegExp(String.raw`"invoiceId"\s*:\s*${invoiceId}(?!\d)`);
      const framesOfInvoice = () => frames.filter((f) => f.includes("client_invoice_payment_recorded") && frameOfInvoice.test(f)).length;
      await expect
        .poll(framesOfInvoice, { message: "trame client_invoice_payment_recorded absente côté logistique", timeout: 15_000 })
        .toBe(1);
      await expect(card).toContainText("Partiel");
      let state = await balanceOf(invoiceId);
      expect(Number(state.row.balance)).toBe(TTC - 50000);

      // Solde : la facture passe à « Payée ».
      const rest = await secretarySession.page.request.post(`/api/billing/invoices/${invoiceId}/payments`, payment(TTC - 50000, { reference: uniqueTestToken("ref") }));
      expect(rest.status(), await rest.text()).toBe(200);
      // Seconde trame pour la même facture : sans elle, « Payée » pourrait venir du polling (AGENTS.md §3).
      await expect
        .poll(framesOfInvoice, { message: "seconde trame client_invoice_payment_recorded absente côté logistique", timeout: 15_000 })
        .toBe(2);
      await expect(card).toContainText("Payée");
      state = await balanceOf(invoiceId);
      expect(state.row.status).toBe("paid");
      expect(Number(state.row.balance)).toBe(0);
      expect(state.payments).toBe(2);
    } finally {
      await logisticsSession.context.close();
      await secretarySession.context.close();
    }
  });

  test("seuls l'admin et la secrétaire encaissent : logistique, technicien et chauffeur reçoivent 403", async ({ browser }) => {
    const technician = await createE2EUser("technician", ids);
    const driver = await createE2EUser("driver", ids);
    const logisticsSession = await openSession(browser, logistics);
    const others = [] as { context: BrowserContext }[];
    try {
      const { invoiceId } = await deliveredMissionWithInvoice(logisticsSession.page.request);
      const attempt = async (api: APIRequestContext, label: string) => {
        const res = await api.post(`/api/billing/invoices/${invoiceId}/payments`, payment(1000));
        expectApiError(res.status(), await res.text(), 403, `rôle ${label}`);
      };
      await attempt(logisticsSession.page.request, "logistics");
      for (const credentials of [technician, driver]) {
        const session = await openSession(browser, credentials);
        others.push(session);
        await attempt(session.page.request, String(credentials.label));
      }
      const state = await balanceOf(invoiceId);
      expect(state.payments).toBe(0);
      expect(Number(state.row.balance)).toBe(TTC);
      expect(state.row.status).toBe("pending");
    } finally {
      await logisticsSession.context.close();
      for (const session of others) await session.context.close();
    }
  });

  test("trop-perçu refusé (409), corps invalide refusé (400), facture soldée refusée (409)", async ({ browser }) => {
    const logisticsSession = await openSession(browser, logistics);
    const secretarySession = await openSession(browser, secretary);
    try {
      const { invoiceId } = await deliveredMissionWithInvoice(logisticsSession.page.request);
      const pay = async (body: unknown) => {
        const res = await secretarySession.page.request.post(`/api/billing/invoices/${invoiceId}/payments`, { data: body });
        return { status: () => res.status(), text: await res.text() };
      };
      const base = { paymentDate: "2026-11-03", paymentMethod: "bank_transfer" };

      const over = await pay({ ...base, amount: TTC + 1 });
      expect(over.status(), over.text).toBe(409);
      const invalid = [
        { label: "montant négatif", body: { ...base, amount: -5 } },
        { label: "montant non numérique", body: { ...base, amount: "abc" } },
        { label: "mode de paiement inconnu", body: { ...base, amount: 1000, paymentMethod: "troc" } },
      ];
      for (const { label, body } of invalid) {
        const res = await pay(body);
        expectApiError(res.status(), res.text, 400, label);
      }

      const state = await balanceOf(invoiceId);
      expect(state.payments).toBe(0);
      expect(Number(state.row.balance)).toBe(TTC);

      expect((await pay({ ...base, amount: TTC })).status()).toBe(200);
      expect((await pay({ ...base, amount: 1 })).status()).toBe(409);
      const after = await balanceOf(invoiceId);
      expect(after.payments).toBe(1);
      expect(Number(after.row.balance)).toBe(0);
    } finally {
      await logisticsSession.context.close();
      await secretarySession.context.close();
    }
  });
});
