import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";

/**
 * ADM2, niveau E : un administrateur change le rôle d'un compte au navigateur.
 *
 * Vert : le magasinier passé technicien perd le stock et gagne ses interventions,
 * à l'écran (menu) comme à l'API, après reconnexion ; une session déjà ouverte suit
 * aussi le nouveau rôle sur les gardes qui relisent la base (`server/middleware/auth.ts`).
 *
 * Défauts figés par `test.fail` (constats de docs/qa/PLAN_COUVERTURE_MODULES.md, ADM2) :
 * - ADM2-1 : /admin/users, « Modifier » n'ouvre aucun formulaire (client/src/pages/admin/users.tsx:327) ;
 * - ADM2-2 : /users, mot de passe laissé vide = enregistrement refusé par le formulaire
 *   (client/src/components/users/user-form.tsx:48 et :75, `partial` ne couvre pas la chaîne vide) ;
 * - ADM2-3 : une session ouverte garde son ancien rôle sur /api/purchase-orders, dont le
 *   `requireAuth` réécrit `req.user.role` depuis la session (server/api/purchase-orders.routes.ts:101).
 *
 * Comptes préfixés E2E-ADM2-, supprimés en fin de spec (et à l'ouverture si un run a planté).
 */

const PREFIX = "E2E-ADM2-";
const ids = createIdBag();
let admin: E2ECredentials & { id: number };
let stamp = 0;

async function purge(): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`));
  if (rows.length === 0) return;
  const bag = createIdBag();
  bag.userIds.push(...rows.map((row) => row.id));
  await cleanupCreated(bag);
}

async function createAccount(role: TestUserRole, label: string): Promise<E2ECredentials & { id: number }> {
  const token = `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;
  const user = await createTestUser({ role, username: token, name: token, email: `${token.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  return { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label };
}

async function roleOf(id: number): Promise<string | undefined> {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
  return row?.role;
}

async function openSession(browser: Browser, credentials: E2ECredentials): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginWithSession(page, credentials);
  return page;
}

async function patchRole(request: APIRequestContext, userId: number, role: string): Promise<void> {
  const response = await request.patch(`/api/users/${userId}`, { data: { role } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Ouvre la boîte « Modifier l'utilisateur » de /users sur la ligne du compte visé. */
async function openEditDialogOnUsersPage(page: Page, username: string) {
  await page.goto("/users", { waitUntil: "domcontentloaded" });
  const row = page.locator("tr", { hasText: username });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByTitle("Modifier").click();
  const dialog = page.getByRole("dialog", { name: "Modifier l'utilisateur" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseRole(page: Page, dialog: ReturnType<Page["getByRole"]>, label: string): Promise<void> {
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

const sidebar = (page: Page) => page.locator('[data-help-target="app-sidebar"]');

test.beforeAll(async () => {
  await purge();
  admin = await createAccount("admin", "admin");
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("ADM2 : changement de rôle par un administrateur", () => {
  test("magasinier passé technicien au navigateur : menu et droits suivent après reconnexion", async ({ browser }) => {
    test.setTimeout(180_000);
    const target = await createAccount("warehouse", "mag");

    // Avant : un magasinier a le stock et les commandes fournisseur.
    const before = await openSession(browser, target);
    await before.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await sidebar(before).getByText("Gestion de stock").click({ timeout: 60_000 });
    await expect(sidebar(before).getByText("Inventaire des pièces")).toBeVisible();
    expect((await before.request.get("/api/purchase-orders")).status()).toBe(200);
    await before.context().close();

    // L'administrateur change le rôle depuis la boîte « Modifier l'utilisateur ».
    const adminPage = await openSession(browser, admin);
    const dialog = await openEditDialogOnUsersPage(adminPage, target.username);
    await chooseRole(adminPage, dialog, "Technicien");
    // Contournement d'ADM2-2 : sans mot de passe, le formulaire refuse d'enregistrer.
    await dialog.getByLabel(/Nouveau mot de passe/).fill(TEST_USER_PASSWORD);
    const [patched] = await Promise.all([
      adminPage.waitForResponse(
        (response) => response.url().includes(`/api/users/${target.id}`) && response.request().method() === "PATCH",
      ),
      dialog.getByRole("button", { name: "Mettre à jour" }).click(),
    ]);
    expect(patched.status(), "PATCH /api/users/:id").toBe(200);
    await expect.poll(() => roleOf(target.id)).toBe("technician");
    await adminPage.context().close();

    // Après reconnexion : menu technicien, plus de stock ; droits API alignés.
    const after = await openSession(browser, target);
    await after.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(sidebar(after).getByText("Mes interventions")).toBeVisible({ timeout: 60_000 });
    await expect(sidebar(after).getByText("Inventaire des pièces")).toHaveCount(0);
    await expect(sidebar(after).getByText("Gestion de stock")).toHaveCount(0);
    expect((await after.request.get("/api/purchase-orders")).status()).toBe(403);
    expect((await after.request.get(`/api/technician/work-orders/${target.id}`)).status()).toBe(200);
    await after.context().close();
  });

  test("session ouverte : les gardes qui relisent la base suivent le nouveau rôle sans reconnexion", async ({ browser }) => {
    const target = await createAccount("warehouse", "open");
    const session = await openSession(browser, target);
    const adminPage = await openSession(browser, admin);
    try {
      expect((await session.request.get(`/api/technician/work-orders/${target.id}`)).status()).toBe(403);
      expect((await session.request.get("/api/purchase-orders/group-suggestions")).status()).toBe(200);

      await patchRole(adminPage.request, target.id, "technician");

      const me = await session.request.get("/api/auth/me");
      expect(me.ok()).toBeTruthy();
      expect(((await me.json()) as { role: string }).role).toBe("technician");
      expect((await session.request.get(`/api/technician/work-orders/${target.id}`)).status()).toBe(200);
      // Garde de montage `authorize` : relit la base, refuse donc le technicien.
      expect((await session.request.get("/api/purchase-orders")).status()).toBe(403);
    } finally {
      await session.context().close();
      await adminPage.context().close();
    }
  });

  test.fail(
    "ADM2-3 : magasinier passé logistique, session ouverte : plus de suggestions de regroupement (403)",
    async ({ browser }) => {
      const target = await createAccount("warehouse", "stale");
      const session = await openSession(browser, target);
      const adminPage = await openSession(browser, admin);
      try {
        await patchRole(adminPage.request, target.id, "logistics");
        expect(await roleOf(target.id)).toBe("logistics");
        // La logistique n'a pas le périmètre « pièces » : 403 attendu, 200 obtenu
        // tant que requireAuth reprend le rôle figé en session.
        expect((await session.request.get("/api/purchase-orders/group-suggestions")).status()).toBe(403);
      } finally {
        await session.context().close();
        await adminPage.context().close();
      }
    },
  );

  test.fail("ADM2-1 : /admin/users, « Modifier » ouvre un formulaire d'édition", async ({ browser }) => {
    const target = await createAccount("warehouse", "adm");
    const adminPage = await openSession(browser, admin);
    try {
      await adminPage.goto("/admin/users", { waitUntil: "domcontentloaded" });
      await adminPage.getByPlaceholder("Rechercher un utilisateur…").fill(target.username);
      const row = adminPage.locator("tr", { hasText: target.username });
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.getByTitle("Modifier").click();
      await expect(adminPage.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    } finally {
      await adminPage.context().close();
    }
  });

  test.fail("ADM2-2 : /users, changer le rôle sans toucher au mot de passe enregistre", async ({ browser }) => {
    const target = await createAccount("warehouse", "nopwd");
    const adminPage = await openSession(browser, admin);
    try {
      const dialog = await openEditDialogOnUsersPage(adminPage, target.username);
      await chooseRole(adminPage, dialog, "Technicien");
      await expect(dialog.getByLabel(/Nouveau mot de passe/)).toHaveValue("");
      await dialog.getByRole("button", { name: "Mettre à jour" }).click();
      await expect.poll(() => roleOf(target.id), { timeout: 5_000 }).toBe("technician");
    } finally {
      await adminPage.context().close();
    }
  });
});
