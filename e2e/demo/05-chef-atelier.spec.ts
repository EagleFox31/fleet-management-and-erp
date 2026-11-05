import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { db } from "../../server/db";
import { users, workOrders } from "../../shared/schema";
import { beat, loginThroughForm, logoutThroughUi } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_OT_PREFIX, DEMO_VEHICLES, seedDemo } from "./seed-demo";

/**
 * Démo « chef d'atelier » : créer un ordre de travail (assistant), l'assigner à un
 * technicien, le démarrer, puis le suivre jusqu'à sa clôture.
 */
const TITLE = `${DEMO_OT_PREFIX}Panne de freinage`;

async function workOrder() {
  const [row] = await db.select().from(workOrders).where(like(workOrders.title, TITLE));
  return row;
}

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

test("démo chef d'atelier : créer, assigner, suivre un OT jusqu'à sa clôture", async ({ page }) => {
  test.setTimeout(120_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.workshopManager.username, DEMO_ACCOUNTS.workshopManager.password);

  await page.getByRole("link", { name: "Ordres de travail" }).first().click();
  await expect(page.getByRole("heading", { name: "Ordres de travail", level: 1 })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
  await page.getByRole("button", { name: "Nouvel OT" }).click();

  // Étape 1 : contexte.
  await page.getByRole("combobox", { name: "Véhicule concerné" }).click();
  await page.getByRole("option", { name: new RegExp(DEMO_VEHICLES.atelierChef) }).click();
  await beat(page);
  await page.getByRole("button", { name: "Suivant" }).click();

  // Étape 2 : intervention.
  await page.getByPlaceholder(/Panne moteur sur route/).fill(TITLE);
  await page.getByRole("textbox", { name: "Description des travaux" }).fill("Freins arrière : bruit et perte d'efficacité, contrôle et remplacement des plaquettes.");
  await beat(page);
  await page.getByRole("button", { name: "Suivant" }).click();

  // Étape 3 : planification, puis création.
  await beat(page, 1200);
  await page.getByRole("button", { name: "Suivant" }).click();
  const row = page.getByRole("row", { name: new RegExp(TITLE) });
  await expect(row).toBeVisible({ timeout: 30_000 });
  expect((await workOrder()).status).toBe("pending");
  await beat(page, 1500);

  // Assignation depuis la liste.
  await row.getByRole("button", { name: "Assigner" }).click();
  await page.getByRole("dialog").getByRole("combobox").click();
  await page.getByRole("option", { name: new RegExp(DEMO_ACCOUNTS.technicianBis.name) }).click();
  await beat(page);
  await page.getByRole("dialog").getByRole("button", { name: "Assigner" }).click();
  const [tech] = await db.select({ id: users.id }).from(users).where(eq(users.username, DEMO_ACCOUNTS.technicianBis.username));
  await expect.poll(async () => (await workOrder()).technicianId, { timeout: 30_000 }).toBe(tech.id);
  await beat(page, 1500);

  // Le technicien assigné démarre l'intervention (le chef ne démarre pas à sa place).
  await logoutThroughUi(page, DEMO_ACCOUNTS.workshopManager.name);
  await loginThroughForm(page, DEMO_ACCOUNTS.technicianBis.username, DEMO_ACCOUNTS.technicianBis.password);
  await page.getByRole("link", { name: "Mes interventions" }).first().click();
  await page.getByRole("tab", { name: /^En attente/ }).click();
  const card = page.locator("div").filter({ hasText: TITLE }).filter({ has: page.locator('[data-help-target="tech-wo-start"]') }).last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);
  await card.locator('[data-help-target="tech-wo-start"]').click();
  const startDialog = page.getByRole("dialog", { name: "Commencer l'intervention" });
  await expect(startDialog).toBeVisible();
  await beat(page, 1200);
  await startDialog.getByRole("button", { name: "Commencer l'intervention" }).click();
  await expect.poll(async () => (await workOrder()).status, { timeout: 30_000 }).toBe("in_progress");
  await beat(page, 2000);

  // Suivi : le chef retrouve l'OT en cours et le clôture.
  await logoutThroughUi(page, DEMO_ACCOUNTS.technicianBis.name);
  await loginThroughForm(page, DEMO_ACCOUNTS.workshopManager.username, DEMO_ACCOUNTS.workshopManager.password);
  await page.getByRole("link", { name: "Ordres de travail" }).first().click();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByText(TITLE).click();
  await expect(page).toHaveURL(/\/maintenance\/work-orders\/\d+/, { timeout: 30_000 });
  await expect(page.getByTestId("button-complete-work-order")).toBeVisible({ timeout: 30_000 });
  await beat(page, 2000);
  await page.getByTestId("button-complete-work-order").click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Terminer/ }).click();
  await expect.poll(async () => (await workOrder()).status, { timeout: 30_000 }).toBe("completed");
  await beat(page, 3000);
});
