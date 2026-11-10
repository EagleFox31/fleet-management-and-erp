import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { clientInvoices, missions } from "../../shared/schema";
import { tinyPdf } from "../../tests/support/pod";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_MISSION, seedDemo } from "./seed-demo";

/**
 * Démo « logistique » : créer une mission pour un donneur d'ordre, l'affecter (véhicule
 * et chauffeur), la lancer avec ses budgets, la livrer, la clôturer, puis générer la
 * facture client. Le règlement de la facture revient au secrétariat (spec suivante).
 */
const ORDER = `${DEMO_MISSION.orderPrefix}001`;

async function missionStatus(): Promise<string | undefined> {
  const [row] = await db.select({ status: missions.status }).from(missions).where(eq(missions.orderNumber, ORDER));
  return row?.status;
}

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

test("démo logistique : de la création de la mission à la facture client", async ({ page }) => {
  test.setTimeout(300_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.logistics.username, DEMO_ACCOUNTS.logistics.password);

  // Création : assistant en quatre étapes.
  await page.getByRole("link", { name: "Missions transport" }).first().click();
  await expect(page.getByTestId("btn-new-mission")).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
  await page.getByTestId("btn-new-mission").click();

  await page.getByTestId("select-client").click();
  await page.getByRole("option", { name: DEMO_MISSION.clientName }).click();
  await page.getByTestId("input-order-number").fill(ORDER);
  await beat(page);
  await page.getByTestId("btn-next").click();

  await page.getByTestId("input-pickup-address").fill("Douala, port autonome");
  await page.getByTestId("input-delivery-address").fill("Yaoundé, entrepôt central");
  await page.getByTestId("textarea-cargo").fill("Palettes de boissons, 18 tonnes");
  await beat(page);
  await page.getByTestId("btn-next").click();

  await page.getByTestId("select-vehicle").click();
  await page.getByRole("option", { name: new RegExp(DEMO_MISSION.vehicle) }).click();
  await beat(page, 600);
  await page.getByTestId("select-driver").click();
  await page.getByRole("option", { name: new RegExp(DEMO_MISSION.driverEmployee) }).click();
  await beat(page);
  await page.getByTestId("btn-next").click();
  await beat(page, 1500);
  await page.getByTestId("btn-submit").click();

  await expect.poll(missionStatus, { timeout: 30_000 }).toBeTruthy();
  await expect(page.getByTestId("table-missions")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("input-search-missions").fill(ORDER);
  await beat(page, 1000);
  await page.getByText(ORDER, { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: ORDER })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);

  // Lancement : budgets demandés, puis la mission part.
  expect(["planned", "assigned"]).toContain(await missionStatus());
  await page.getByTestId("button-transition-mission-status-header").click();
  await expect(page.getByTestId("button-save-mission-budgets")).toBeVisible({ timeout: 15_000 });
  for (const [field, value] of [["fuelBudget", "1000"], ["roadExpensesBudget", "5000"], ["contingencyBudget", "2000"]] as const) {
    const input = page.getByTestId(`input-mission-budget-${field}`);
    await expect(input).toBeVisible();
    await input.fill(value);
    await beat(page, 400);
  }
  await page.getByTestId("button-save-mission-budgets").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("in_progress");
  await beat(page, 1500);

  // Livraison.
  await page.getByTestId("button-transition-mission-status-header").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("delivered");
  await beat(page, 1500);

  // Preuve de livraison : sans elle, la facture reste fermée.
  await page.getByTestId("button-pod-deposit-header-input").setInputFiles({
    name: "bon-de-livraison.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf("demo-logistique"),
  });
  await expect(page.getByTestId("pod-list")).toContainText("bon-de-livraison.pdf", { timeout: 30_000 });
  await beat(page, 1500);

  // Clôture : aucun plein rattaché (motif), frais de route réels.
  await page.getByTestId("button-transition-mission-status-header").click();
  await page.getByTestId("textarea-mission-no-fuel-reason").fill("Mission courte, aucun ravitaillement.");
  await beat(page, 600);
  await page.getByTestId("button-declare-no-fuel-and-close").click();
  await page.getByTestId("input-mission-close-fdr").fill("0");
  await beat(page, 600);
  await page.getByTestId("button-confirm-mission-close-fdr").click();
  await expect.poll(missionStatus, { timeout: 30_000 }).toBe("completed");
  await beat(page, 1500);

  // Facture client depuis la mission clôturée.
  await page.getByTestId("button-open-generate-invoice-dialog").click();
  await page.getByTestId("input-amount").fill("250000");
  await page.getByTestId("input-due-date").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await beat(page, 800);
  await page.getByTestId("button-submit-invoice").click();
  await expect(page).toHaveURL(/\/operations\/invoices\/\d+$/, { timeout: 30_000 });
  const [mission] = await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, ORDER));
  const invoices = await db.select().from(clientInvoices).where(eq(clientInvoices.missionId, mission.id));
  expect(invoices).toHaveLength(1);
  await beat(page, 3000);
});
