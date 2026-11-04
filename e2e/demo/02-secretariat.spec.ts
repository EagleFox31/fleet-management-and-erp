import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { join } from "path";
import { db } from "../../server/db";
import { vehicleDocuments } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { DEMO_ACCOUNTS, DEMO_DOCUMENT_NAME, DEMO_VEHICLES } from "./seed-demo";

/**
 * Démo « secrétariat » : documents et conformité, renouvellement de l'assurance d'un
 * véhicule qui expire dans 10 jours, l'échéance proche disparaît. Un seul navigateur.
 */
test("démo secrétariat : renouveler une assurance proche de l'échéance", async ({ page }) => {
  test.setTimeout(180_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.secretary.username, DEMO_ACCOUNTS.secretary.password);

  // Le tableau de bord annonce l'échéance proche avant le renouvellement.
  await expect(page.getByTestId("secretary-kpi-documents")).toContainText("1 à venir", { timeout: 30_000 });
  await beat(page, 2000);
  await page.getByText("Ressources Véhicules", { exact: true }).click();
  await beat(page, 600);
  await page.getByRole("link", { name: "Documents & Conformité" }).first().click();
  await expect(page.getByTestId("kpi-docs-expiring")).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);
  await page.getByTestId("input-documents-vehicle-search").fill(DEMO_VEHICLES.secretary);
  await expect(page.getByText(DEMO_DOCUMENT_NAME).first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);

  await page.getByRole("button", { name: "Voir le document sur la fiche véhicule" }).first().click();
  await expect(page.getByText(DEMO_DOCUMENT_NAME, { exact: true })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);

  await page.getByRole("button", { name: "Demander renouvellement" }).first().click();
  await expect(page).toHaveURL(/\/vehicles\/documents\/renew/, { timeout: 30_000 });
  await beat(page, 1000);

  await page.getByPlaceholder(/Visite technique effectuée/).fill("Assurance renouvelée ce jour pour douze mois.");
  await beat(page, 600);
  await page.getByRole("combobox").nth(1).click();
  await beat(page, 600);
  await page.getByRole("option", { name: "+ Ajouter un nouveau centre" }).click();
  await page.getByPlaceholder("Ex: Centre Auto Contrôle Bonabéri").fill("Assurances Douala Centre");
  await beat(page, 800);
  await page.getByRole("button", { name: /Étape suivante/ }).click();
  await beat(page, 800);

  const newExpiry = new Date();
  newExpiry.setUTCFullYear(newExpiry.getUTCFullYear() + 1);
  await page.locator('input[type="date"]').first().fill(newExpiry.toISOString().slice(0, 10));
  await page.locator('input[type="file"]').setInputFiles(join(process.cwd(), "e2e/demo/fixtures/attestation-demo.pdf"));
  await beat(page, 1200);
  await page.getByRole("button", { name: /Enregistrer le renouvellement/ }).click();
  await expect(page.locator('li[role="status"]').filter({ hasText: "Document renouvelé" })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);

  await expect
    .poll(async () => {
      const [doc] = await db.select().from(vehicleDocuments).where(and(eq(vehicleDocuments.name, DEMO_DOCUMENT_NAME)));
      return doc?.expiryDate ?? "";
    }, { timeout: 30_000 })
    .toBe(newExpiry.toISOString().slice(0, 10));

  // Retour au tableau de bord : plus aucune échéance proche.
  await page.getByRole("link", { name: "Tableau de bord" }).first().click();
  await expect(page.getByTestId("secretary-kpi-documents")).toContainText("0 expiré(s) · 0 à venir", { timeout: 30_000 });
  await beat(page, 3000);
});
