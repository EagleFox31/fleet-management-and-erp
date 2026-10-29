import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { clientPayments } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestClientInvoice, createTestPart } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Priorité 1 du plan de couverture, niveau UI :
 * - T3 / AGENTS.md §10 : un refus du serveur s'affiche en toast lisible, sans détail technique ;
 * - T1 : une action interdite au rôle n'est pas proposée (bouton absent ou désactivé
 *   avec sa raison), au lieu d'être affichée puis refusée par un toast « accès refusé ».
 */

const TECHNICAL_LEAK = /stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|\{"|^\d{3}:/;
const ids = createIdBag();
let secretary: E2ECredentials;
let logistics: E2ECredentials;
let warehouse: E2ECredentials;
let admin: E2ECredentials;

async function newInvoice() {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

test.beforeAll(async () => {
  secretary = await createE2EUser("secretary", ids);
  logistics = await createE2EUser("logistics", ids);
  warehouse = await createE2EUser("warehouse", ids);
  admin = await createE2EUser("admin", ids);
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

test.describe("Écrans : refus lisibles et actions selon le rôle", () => {
  test("T3 : un paiement au-delà du solde affiche un toast métier, sans paiement créé", async ({ page }) => {
    const invoice = await newInvoice();
    await loginWithSession(page, secretary);
    await page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("button-record-payment").click();
    await page.getByTestId("input-payment-amount").fill("999999999");
    await page.getByTestId("button-confirm-payment").click();

    // `li` : Radix double chaque toast d'un `span role="status"` pour les lecteurs d'écran.
    const toast = page.locator('li[role="status"]').filter({ hasText: "Erreur" });
    await expect(toast).toContainText("Montant supérieur au solde restant");
    expect(await toast.innerText()).not.toMatch(TECHNICAL_LEAK);
    await expect(page.getByTestId("payment-row-0")).toHaveCount(0);
    expect(await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoice.id))).toHaveLength(0);
  });

  test("T1 : la logistique voit la facture mais ne peut pas lancer un paiement", async ({ page }) => {
    const invoice = await newInvoice();
    await loginWithSession(page, logistics);
    await page.goto(`/operations/invoices/${invoice.id}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("balance-due")).toBeVisible();
    const button = page.getByTestId("button-record-payment");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", /Réservé/);
  });

  test("T1 : le magasinier modifie une pièce mais ne voit pas la suppression, l'admin la voit", async ({ page }) => {
    const part = await createTestPart();
    ids.partIds.push(part.id);

    for (const [user, canDelete] of [[warehouse, false], [admin, true]] as const) {
      await page.context().clearCookies();
      await loginWithSession(page, user);
      await page.goto("/inventory", { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("Rechercher une pièce...").fill(part.reference);

      await expect(page.getByTestId(`btn-edit-part-${part.id}`), user.label).toBeVisible();
      await expect(page.getByTestId(`btn-delete-part-${part.id}`), user.label).toHaveCount(canDelete ? 1 : 0);
    }
  });
});
