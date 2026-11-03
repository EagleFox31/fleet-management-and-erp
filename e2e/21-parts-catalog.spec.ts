import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { partSpecifications, partVariants, parts } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * PRT1 niveau navigateur : catalogue de pièces (CRUD pièce, variante, spécification ;
 * la catégorie est un texte libre de la fiche, sans route propre).
 *
 * Le contrat HTTP (`tests/contract/parts-catalog-*`) couvre déjà les codes d'erreur et les rôles route
 * par route : ici on ne rejoue que le parcours écran et ce que l'écran affirme, relu en base.
 *
 * Limite d'interface : variantes et spécifications n'ont AUCUN écran atteignable.
 * `client/src/pages/inventory/parts-database.tsx` les porte, mais aucune route de `App.tsx`
 * ne la monte. Elles sont donc exercées par l'API, dans la session du magasinier, et leur
 * cascade est vérifiée à la suppression de la pièce par l'écran de l'admin.
 */

const ids = createIdBag();
let warehouse: E2ECredentials & { id: number };
let observer: E2ECredentials & { id: number };
let admin: E2ECredentials & { id: number };

test.beforeAll(async () => {
  warehouse = await createE2EUser("warehouse", ids);
  observer = await createE2EUser("workshop_manager", ids);
  admin = await createE2EUser("admin", ids);
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

async function partByReference(reference: string) {
  const [row] = await db.select().from(parts).where(eq(parts.reference, reference));
  return row;
}

async function switchUser(page: Page, user: E2ECredentials) {
  await page.context().clearCookies();
  await loginWithSession(page, user);
}

/** Actions des trames `part_catalog_changed` qui visent cette pièce, dans l'ordre de réception. */
function partCatalogActionsFor(frames: readonly string[], partId: number): string[] {
  const actions: string[] = [];
  for (const frame of frames) {
    try {
      const message = JSON.parse(frame) as { type?: string; payload?: { id?: number; action?: string } };
      if (message.type === "part_catalog_changed" && message.payload?.id === partId && message.payload.action) {
        actions.push(message.payload.action);
      }
    } catch {
      // trame non JSON : ignorée
    }
  }
  return actions;
}

test.describe("PRT1 - catalogue de pièces (navigateur)", () => {
  test("le magasinier crée, retrouve et modifie une pièce ; seul l'admin la supprime", async ({ page }) => {
    test.setTimeout(120_000);
    const reference = uniqueTestToken("prt1");
    const name = `Filtre ${reference}`;

    await switchUser(page, warehouse);

    // 1. Création par le formulaire, catégorie saisie librement ("Autre...").
    await page.goto("/inventory/new", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Nom", { exact: true }).fill(name);
    await page.getByLabel("Référence", { exact: true }).fill(reference);
    await page.getByLabel("Catégorie", { exact: true }).click();
    await page.getByRole("option", { name: "Autre..." }).click();
    await page.getByLabel("Catégorie personnalisée").fill("Visserie e2e");
    await page.getByLabel("Quantité en stock").fill("12");
    await page.getByLabel("Prix unitaire (XAF)").fill("12500");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    // Ce que l'écran affirme (toast « Pièce créée ») est relu en base, avec l'auteur.
    const created = await partByReference(reference);
    expect(created, "la pièce doit exister en base").toBeTruthy();
    ids.partIds.push(created.id);
    expect(created.name).toBe(name);
    expect(created.category).toBe("Visserie e2e");
    expect(created.quantity).toBe(12);
    expect(Number(created.unitPrice)).toBe(12500);
    expect(created.createdBy).toBe(warehouse.id);
    expect(created.updatedBy).toBe(warehouse.id);

    // 2. Retrouvée dans le tableau par la recherche.
    await page.getByPlaceholder("Rechercher une pièce...").fill(reference);
    await expect(page.getByText(reference).first()).toBeVisible();
    await expect(page.getByTestId(`btn-edit-part-${created.id}`)).toBeVisible();

    // 3. Modification : catégorie et prix.
    await page.getByTestId(`btn-edit-part-${created.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/inventory/${created.id}\\?tab=edit`));
    await page.getByLabel("Catégorie personnalisée").fill("Visserie e2e v2");
    await page.getByLabel("Prix unitaire (XAF)").fill("15000");
    await page.getByRole("button", { name: "Mettre à jour" }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    const edited = await partByReference(reference);
    expect(edited.category).toBe("Visserie e2e v2");
    expect(Number(edited.unitPrice)).toBe(15000);
    expect(edited.updatedBy).toBe(warehouse.id);
    expect(edited.createdBy).toBe(warehouse.id);

    // 4. Variante et spécification : API seule, aucun écran atteignable (voir l'en-tête).
    const variant = await page.request.post(`/api/parts/${created.id}/variants`, {
      data: { variantName: "Grand modèle", variantCode: `${reference}-V1`, additionalPrice: 500 },
    });
    expect(variant.status()).toBe(201);
    const spec = await page.request.post(`/api/parts/${created.id}/specifications`, {
      data: { specificationName: "Diamètre", specificationValue: "55", unit: "mm" },
    });
    expect(spec.status()).toBe(201);
    expect(await db.select().from(partVariants).where(eq(partVariants.partId, created.id))).toHaveLength(1);
    expect(await db.select().from(partSpecifications).where(eq(partSpecifications.partId, created.id))).toHaveLength(1);

    // 5. Actions selon le rôle : le magasinier modifie, il ne voit pas la corbeille.
    await page.goto("/inventory", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Rechercher une pièce...").fill(reference);
    await expect(page.getByTestId(`btn-edit-part-${created.id}`)).toBeVisible();
    await expect(page.getByTestId(`btn-delete-part-${created.id}`)).toHaveCount(0);
    // Le serveur refuse aussi (la corbeille absente n'est pas la seule barrière).
    expect((await page.request.delete(`/api/parts/${created.id}`)).status()).toBe(403);
    expect(await partByReference(reference)).toBeTruthy();

    // 6. L'admin supprime par l'écran ; variante et spécification partent en cascade.
    await switchUser(page, admin);
    await page.goto("/inventory", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("Rechercher une pièce...").fill(reference);
    await page.getByTestId(`btn-delete-part-${created.id}`).click();
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect.poll(async () => Boolean(await partByReference(reference))).toBe(false);
    expect(await db.select().from(partVariants).where(eq(partVariants.partId, created.id))).toHaveLength(0);
    expect(await db.select().from(partSpecifications).where(eq(partSpecifications.partId, created.id))).toHaveLength(0);
  });

  test.describe("temps réel inter-profils", () => {
    /**
     * Mise en place dans un beforeAll : le témoin ci-dessous vérifie la mise en place, le test suivant
     * ne contient que l'attente de la trame.
     */
    const reference = uniqueTestToken("prt1-rt");
    const frames: string[] = [];
    const setup = { socketReady: false, createStatus: 0, patchStatus: 0, partId: 0 };
    const contexts: BrowserContext[] = [];

    test.beforeAll(async ({ browser }) => {
      const observerContext = await browser.newContext();
      const writerContext = await browser.newContext();
      contexts.push(observerContext, writerContext);

      const observerPage = await observerContext.newPage();
      observerPage.on("websocket", (socket) => {
        if (!socket.url().includes("/ws")) return;
        socket.on("framereceived", (frame) => {
          frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
        });
      });
      await loginWithSession(observerPage, observer);
      await observerPage.goto("/inventory/parts", { waitUntil: "domcontentloaded" });
      await observerPage.getByPlaceholder("Rechercher une pièce...").waitFor();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && !frames.some((f) => f.includes("auth_success"))) {
        await observerPage.waitForTimeout(250);
      }
      setup.socketReady = frames.some((f) => f.includes("auth_success"));

      const writerPage = await writerContext.newPage();
      await loginWithSession(writerPage, warehouse);
      const created = await writerPage.request.post("/api/parts", {
        data: { name: `Pièce ${reference}`, reference, quantity: 3, minQuantity: 1, unit: "pièce", unitPrice: "1000" },
      });
      setup.createStatus = created.status();
      if (created.status() === 201) {
        setup.partId = (await created.json()).id;
        ids.partIds.push(setup.partId);
        const patched = await writerPage.request.patch(`/api/parts/${setup.partId}`, { data: { unitPrice: "2000" } });
        setup.patchStatus = patched.status();
      }
    });

    test.afterAll(async () => {
      await Promise.all(contexts.map((context) => context.close()));
    });

    test("témoin : l'observateur est branché au temps réel, la pièce est créée puis modifiée", () => {
      expect(setup.socketReady, "socket /ws de l'observateur établie (auth_success)").toBe(true);
      expect(setup.createStatus, "création par le magasinier").toBe(201);
      expect(setup.patchStatus, "modification par le magasinier").toBe(200);
    });

    /**
     * Couche 2 de AGENTS.md §2 : le CRUD des pièces émet part_catalog_changed (corrigé par #165,
     * server/api/parts-catalog.routes.ts). Un second profil sur /inventory/parts reçoit la trame.
     */
    test("une pièce créée ou modifiée par le magasinier émet une trame WebSocket chez un autre profil", async () => {
      // Deux trames distinctes pour la même pièce : la création, puis la modification.
      await expect
        .poll(() => partCatalogActionsFor(frames, setup.partId), {
          timeout: 8_000,
          message: "trames part_catalog_changed (created puis updated) non reçues par le profil observateur",
        })
        .toEqual(["created", "updated"]);
    });
  });
});
