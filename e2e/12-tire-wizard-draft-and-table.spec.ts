import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { activityLogs, tires } from "../shared/schema";
import { getDefaultTireFormValues } from "../shared/tire-form";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";
import { newE2EContext } from "./helpers/contexts";

/**
 * TIR5 — brouillon du wizard pneu : enregistré pendant la saisie, restauré au
 * retour, purgé après création ; un double clic ne crée qu'une fiche (AGENTS.md §10).
 * TIR6 — tableau stock : ligne en stock bas surlignée, corbeille réservée à l'admin.
 */

const ids = createIdBag();
const modelPrefix = uniqueTestToken("e2e-tire-wiz");
let warehouse: E2ECredentials & { id: number };
let admin: E2ECredentials & { id: number };
let lowStockTireId: number;

const draftKey = (userId: number) => `fleetos-tire-wizard-draft-v1-${userId}`;
const readDraft = (page: Page, userId: number) =>
  page.evaluate((key) => window.localStorage.getItem(key), draftKey(userId));

async function openWizard(page: Page) {
  await page.goto("/inventory/tires", { waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-new-tire").click();
}

test.beforeAll(async () => {
  warehouse = await createE2EUser("warehouse", ids);
  admin = await createE2EUser("admin", ids);
  const [tire] = await db
    .insert(tires)
    .values({ brand: "TEST-MARQUE", model: `${modelPrefix}-bas`, size: "315/80R22.5", stockQuantity: 0, minStockLevel: 2 })
    .returning();
  lowStockTireId = tire.id;
});

test.afterAll(async () => {
  await db.delete(tires).where(like(tires.model, `${modelPrefix}%`));
  if (ids.userIds.length > 0) {
    await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  }
  await cleanupCreated(ids);
});

test("magasinier : le brouillon du wizard est restauré, puis purgé après une seule création", async ({ page }) => {
  test.setTimeout(300_000);
  await loginWithSession(page, warehouse);
  await openWizard(page);

  const draftModel = `${modelPrefix}-brouillon`;
  await page.getByPlaceholder("ex: X Multi Energy").fill(draftModel);
  await expect
    .poll(() => readDraft(page, warehouse.id), { message: "Le brouillon n'est pas enregistré pendant la saisie" })
    .toContain(draftModel);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-new-tire").click();
  await expect(page.locator('li[role="status"]').filter({ hasText: "Brouillon restauré" })).toBeVisible();
  await expect(page.getByPlaceholder("ex: X Multi Energy")).toHaveValue(draftModel);

  // Brouillon complet arrêté à la dernière étape : seul l'enregistrement reste à faire.
  const finalModel = `${modelPrefix}-final`;
  const data = {
    ...getDefaultTireFormValues(),
    brand: "TEST-MARQUE",
    model: finalModel,
    manufacturingWeek: "10",
    stockQuantity: 3,
    minStockLevel: 1,
    purchasePrice: 150000,
    supplier: "Fournisseur e2e",
    location: "Rayon E2E",
  };
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [draftKey(warehouse.id), JSON.stringify({ version: 1, data, savedAt: new Date().toISOString(), meta: { step: 5 } })],
  );

  const createCalls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/tires") createCalls.push(request.url());
  });
  // Changer d'onglet démonte le wizard : le retour relit le brouillon sans recharger la page
  // (un rechargement de plus dépasse le délai de 8 s du contrôle de session sur le serveur de dev).
  await page.getByTestId("tab-inventory").click();
  await page.getByTestId("tab-new-tire").click();
  await expect(page.getByText("Étape 5/5")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le pneu" }).dblclick();

  await expect(page.locator('li[role="status"]').filter({ hasText: "Pneu ajouté" })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(createCalls).toHaveLength(1);
  expect(await readDraft(page, warehouse.id)).toBeNull();

  const created = await db.select().from(tires).where(eq(tires.model, finalModel));
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ stockQuantity: 3, createdBy: warehouse.id });
});

test("tableau pneus : stock bas surligné, corbeille réservée à l'admin", async ({ browser }) => {
  test.setTimeout(300_000);
  for (const [user, canDelete] of [
    [warehouse, false],
    [admin, true],
  ] as const) {
    const context = await newE2EContext(browser, "profil");
    try {
      const page = await context.newPage();
      await loginWithSession(page, user);
      await page.goto("/inventory/tires", { waitUntil: "domcontentloaded" });
      await page.getByPlaceholder("Rechercher par marque, modèle ou dimension…").fill(`${modelPrefix}-bas`);

      const row = page.locator("tr").filter({ hasText: `${modelPrefix}-bas` });
      await expect(row).toHaveCount(1);
      await expect(row).toHaveClass(/border-l-red-400/);
      await expect(row.getByTestId(`button-edit-tire-${lowStockTireId}`)).toBeVisible();
      await expect(row.getByTestId(`btn-adjust-tire-stock-${lowStockTireId}`)).toBeVisible();
      await expect(row.getByTestId(`button-delete-tire-${lowStockTireId}`)).toHaveCount(canDelete ? 1 : 0);
    } finally {
      await context.close();
    }
  }
});
