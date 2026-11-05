import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { missions } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_DRIVER_DAY, seedDemo } from "./seed-demo";

/**
 * Démo « chauffeur » : il ouvre son tableau de bord, voit la mission du jour
 * et confirme le départ.
 */
test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

const statusOfMission = async () =>
  (await db.select({ status: missions.status }).from(missions).where(eq(missions.orderNumber, DEMO_DRIVER_DAY.orderNumber)))[0]?.status;

test("démo chauffeur : voir la mission du jour et confirmer le départ", async ({ page }) => {
  test.setTimeout(120_000);
  expect(await statusOfMission()).toBe("assigned");
  await loginThroughForm(page, DEMO_ACCOUNTS.driver.username, DEMO_ACCOUNTS.driver.password);

  await expect(page.getByText(DEMO_DRIVER_DAY.delivery).first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 3000);

  const start = page.locator('[data-help-target="driver-status-action"]');
  await expect(start).toContainText("CONFIRMER LE DÉPART");
  await beat(page, 1500);
  await start.click();

  await expect(page.getByText("Départ confirmé !", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(start).toContainText("CONFIRMER LA LIVRAISON");
  await expect.poll(statusOfMission, { timeout: 30_000 }).toBe("in_progress");
  await beat(page, 3000);
});
