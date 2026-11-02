import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
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
 * Limite assumée : le lancement d'une mission exige affectation, documents du
 * véhicule et CPC du chauffeur (`PUT /api/missions/:id/status`). Ce parcours ne
 * le rejoue pas : la mission est créée par l'API puis posée à « livrée » en
 * base, état à partir duquel l'écran autorise la facturation.
 */

const HT = 100000;
const TTC = 119250; // TVA 19,25 %
const ids = createIdBag();
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
