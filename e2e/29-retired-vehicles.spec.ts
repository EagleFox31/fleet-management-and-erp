import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { vehicleDocuments, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Écran admin « Véhicules retirés » (L4). Un véhicule qui porte un document est retiré en douceur :
 * il quitte la flotte, apparaît dans la liste des retirés, sa fiche passe en consultation seule,
 * puis la restauration le remet dans la flotte. Admin seul : le temps réel inter-profils n'est pas
 * vérifié ici (contrat `vehicle-lifecycle` pour la trame vehicle_restored).
 */

const ids = createIdBag();
let admin: E2ECredentials;

test.beforeAll(async () => {
  admin = await createE2EUser("admin", ids);
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

test("admin : retirer, retrouver dans les retirés, consulter, restaurer", async ({ page }) => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  // Un document suffit à rendre le retrait doux (sans activité, la ligne serait supprimée).
  const name = uniqueTestToken("doc");
  await db.insert(vehicleDocuments).values({
    vehicleId: vehicle.id,
    name,
    type: "autre",
    filename: `${name}.pdf`,
    filesize: 4,
    fileType: "application/pdf",
    filePath: `uploads/${name}.pdf`,
  });

  await loginWithSession(page, admin);
  await page.goto(`/vehicles/${vehicle.id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles$/, { timeout: 20_000 });

  await page.goto("/admin/retired-vehicles", { waitUntil: "domcontentloaded" });
  const row = page.getByRole("row").filter({ hasText: vehicle.registrationNumber });
  await expect(row).toBeVisible({ timeout: 20_000 });

  // Ligne cliquable : fiche en consultation seule, sans bouton de suppression.
  await row.getByText(vehicle.registrationNumber, { exact: true }).click();
  await expect(page.getByText(/Véhicule retiré de la flotte le/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Supprimer", exact: true })).toHaveCount(0);

  await page.goto("/admin/retired-vehicles", { waitUntil: "domcontentloaded" });
  await row.getByRole("button", { name: "Restaurer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restaurer", exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 20_000 });

  const row0 = async () => (await db.select({ deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, vehicle.id)))[0];
  await expect.poll(row0, { timeout: 15_000 }).toEqual({ deletedAt: null });

  await page.goto(`/vehicles/${vehicle.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Supprimer", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Véhicule retiré de la flotte le/)).toHaveCount(0);
});
