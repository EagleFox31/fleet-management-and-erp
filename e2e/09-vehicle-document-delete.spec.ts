import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { db } from "../server/db";
import { vehicleDocuments } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Suppression d'un document véhicule, niveau UI. `deleteVehicleDocument` était un
 * bouchon : l'écran affichait « Document supprimé » sans rien supprimer.
 * - le chef d'atelier supprime : ligne, fichier et affichage disparaissent, un
 *   double clic n'envoie qu'une requête (AGENTS.md §10) ;
 * - T1 : la secrétaire voit le document mais pas la corbeille (le serveur la refuse).
 */

const ids = createIdBag();
const uploadsSubdir = uniqueTestToken("e2e-docs");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);
let manager: E2ECredentials;
let secretary: E2ECredentials;

async function newDocument() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  mkdirSync(uploadsDir, { recursive: true });
  const name = uniqueTestToken("doc");
  const file = join(uploadsDir, `${name}.pdf`);
  writeFileSync(file, "TEST");
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId: vehicle.id,
      name,
      type: "autre",
      filename: `${name}.pdf`,
      filesize: 4,
      fileType: "application/pdf",
      filePath: join("uploads", uploadsSubdir, `${name}.pdf`),
    })
    .returning();
  return { doc, file };
}

// Par préfixe : l'ancien bouton s'appelait « Supprimer » (title), le nouveau
// « Supprimer le document ». Le test vaut donc aussi contre l'ancien écran.
function deleteButtons(page: Page) {
  return page.getByRole("tabpanel").getByRole("button", { name: /^Supprimer/ });
}

test.beforeAll(async () => {
  manager = await createE2EUser("workshop_manager", ids);
  secretary = await createE2EUser("secretary", ids);
});

test.afterAll(async () => {
  // Documents : supprimés en cascade avec le véhicule.
  await cleanupCreated(ids);
  rmSync(uploadsDir, { recursive: true, force: true });
});

test.describe("Documents véhicule : suppression", () => {
  test("chef d'atelier : le document disparaît de l'écran, de la base et du disque", async ({ page }) => {
    const { doc, file } = await newDocument();
    const deleteCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE" && request.url().includes(`/api/documents/${doc.id}`)) deleteCalls.push(request.url());
    });

    await loginWithSession(page, manager);
    await page.goto(`/vehicles/${doc.vehicleId}?tab=documents`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(doc.name, { exact: true })).toBeVisible({ timeout: 20_000 });

    await deleteButtons(page).click();
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).dblclick();

    await expect(page.locator('li[role="status"]').filter({ hasText: "Document supprimé" })).toBeVisible();
    await expect(page.getByText(doc.name, { exact: true })).toHaveCount(0);
    await expect(page.locator('li[role="status"]').filter({ hasText: "Erreur" })).toHaveCount(0);
    expect(deleteCalls).toHaveLength(1);
    expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, doc.id))).toHaveLength(0);
    expect(existsSync(file)).toBe(false);
  });

  test("T1 : la secrétaire voit le document sans corbeille", async ({ page }) => {
    const { doc, file } = await newDocument();
    await loginWithSession(page, secretary);
    await page.goto(`/vehicles/${doc.vehicleId}?tab=documents`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(doc.name, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Télécharger" }).first()).toBeVisible();
    await expect(deleteButtons(page)).toHaveCount(0);
    expect(existsSync(file)).toBe(true);
  });
});
