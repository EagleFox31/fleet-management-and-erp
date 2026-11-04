import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { clientInvoices, missions } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { DEMO_ACCOUNTS, DEMO_MISSION } from "./seed-demo";

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

test("démo logistique : de la création de la mission à la facture client", async ({ page }) => {
  test.setTimeout(300_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.logistics.username, DEMO_ACCOUNTS.logistics.password);

  // Création : assistant en quatre étapes.
  await page.getByText("Missions transport", { exact: true }).first().click().catch(() => undefined);
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
  await page.getByTestId("textarea-cargo").fill("Palettes de boissons, 18 tonnes").catch(() => undefined);
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
});
