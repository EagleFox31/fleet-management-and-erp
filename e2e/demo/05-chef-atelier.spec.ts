import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { db } from "../../server/db";
import { users, workOrders } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_OT_PREFIX, DEMO_VEHICLES } from "./seed-demo";

/**
 * Démo « chef d'atelier » : créer un ordre de travail (assistant), l'assigner à un
 * technicien, le démarrer, puis le suivre jusqu'à sa clôture.
 */
const TITLE = `${DEMO_OT_PREFIX}Panne de freinage`;

async function workOrder() {
  const [row] = await db.select().from(workOrders).where(like(workOrders.title, TITLE));
  return row;
}

test.beforeAll(() => assertLocalDatabase());

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
  await page.getByRole("option", { name: new RegExp(DEMO_ACCOUNTS.technician.name) }).click();
  await beat(page);
  await page.getByRole("dialog").getByRole("button", { name: "Assigner" }).click();
  const [tech] = await db.select({ id: users.id }).from(users).where(eq(users.username, DEMO_ACCOUNTS.technician.username));
  await expect.poll(async () => (await workOrder()).technicianId, { timeout: 30_000 }).toBe(tech.id);
  await beat(page, 1500);

  // Suivi : le détail de l'OT, démarrage puis clôture.
  await row.getByRole("button", { name: "Voir OT" }).click();
  await expect(page.getByTestId("button-start-work-order")).toBeVisible({ timeout: 30_000 });
  await beat(page, 1800);
  await page.getByTestId("button-start-work-order").click();
  await beat(page, 800);
  await page.getByRole("alertdialog").getByRole("button", { name: /Commencer|Démarrer|Confirmer/ }).click();
  await expect.poll(async () => (await workOrder()).status, { timeout: 30_000 }).toBe("in_progress");
  await expect(page.getByTestId("button-complete-work-order")).toBeVisible({ timeout: 30_000 });
  await beat(page, 2000);
  await page.getByTestId("button-complete-work-order").click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Terminer/ }).click();
  await expect.poll(async () => (await workOrder()).status, { timeout: 30_000 }).toBe("completed");
  await beat(page, 3000);
});
