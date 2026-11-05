import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { partRequirements, workOrders } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_PART, DEMO_WORK_ORDER_TITLE, seedDemo } from "./seed-demo";

/**
 * Démo « technicien » (E2E_DEMO=1, état de départ : node --import tsx e2e/demo/seed-demo.ts, avec DATABASE_URL local, voir README).
 * Parcours : connexion, démarrage de son intervention (Commencer), ouverture de son intervention, demande d'une pièce (le technicien ne
 * sort pas de stock : le magasinier sort), clôture de l'OT. Un seul navigateur.
 */
test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

test("démo technicien : demander une pièce puis clôturer son intervention", async ({ page }) => {
  test.setTimeout(180_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.technician.username, DEMO_ACCOUNTS.technician.password);

  await page.getByRole("link", { name: "Mes interventions" }).first().click();
  await page.getByRole("tab", { name: /^En attente/ }).click();
  await expect(page.getByText(DEMO_WORK_ORDER_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);

  // Geste de démarrage : le technicien commence l intervention qui lui est assignée.
  await page.locator("div").filter({ hasText: DEMO_WORK_ORDER_TITLE }).filter({ has: page.locator('[data-help-target="tech-wo-start"]') }).last().locator('[data-help-target="tech-wo-start"]').click();
  const startDialog = page.getByRole("dialog", { name: "Commencer l'intervention" });
  await expect(startDialog).toBeVisible();
  await beat(page, 1200);
  await startDialog.getByRole("button", { name: "Commencer l'intervention" }).click();
  await expect.poll(async () => (await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.title, DEMO_WORK_ORDER_TITLE)))[0]?.status, { timeout: 30_000 }).toBe("in_progress");
  await beat(page, 1500);
  await page.getByRole("tab", { name: /^En cours/ }).click();
  await expect(page.getByText(DEMO_WORK_ORDER_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);

  await page.getByRole("link", { name: "Voir détails" }).first().click();
  await expect(page).toHaveURL(/\/maintenance\/work-orders\/\d+/, { timeout: 30_000 });
  const workOrderId = Number(page.url().match(/work-orders\/(\d+)/)![1]);
  await expect(page.getByTestId("button-complete-work-order")).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);

  await page.getByRole("tab", { name: /^Pièces/ }).click();
  await beat(page);
  await page.getByRole("button", { name: "Demander une pièce" }).click();
  const dialog = page.getByRole("dialog");
  await beat(page, 600);
  await dialog.getByRole("combobox").click();
  await beat(page, 600);
  await page.getByRole("option", { name: new RegExp(DEMO_PART.reference) }).click();
  await dialog.getByLabel("Quantité").fill("2");
  await beat(page, 1200);
  await dialog.getByTestId("btn-add-part-confirm").click();
  await expect(page.locator('li[role="status"]').filter({ hasText: "Pièce demandée" })).toBeVisible();
  await beat(page, 1500);

  await page.getByTestId("button-complete-work-order").click();
  await beat(page, 1000);
  await page.getByRole("alertdialog").getByRole("button", { name: "Terminer l'OT" }).click();
  await expect.poll(async () => (await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)))[0].status, { timeout: 30_000 }).toBe("completed");
  await beat(page, 2000);

  const requirements = await db.select().from(partRequirements).where(and(eq(partRequirements.workOrderId, workOrderId)));
  expect(requirements.length, "la demande de pièce est enregistrée").toBeGreaterThan(0);
});
