import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { users } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, seedDemo } from "./seed-demo";

/**
 * Démo « administrateur » : depuis le menu Administration, il ouvre la fiche d'un compte
 * (magasinier) et lui donne le rôle de technicien.
 */
test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

const roleOfRecruit = async () =>
  (await db.select({ role: users.role }).from(users).where(eq(users.username, DEMO_ACCOUNTS.recruit.username)))[0]?.role;

test("démo administrateur : changer le rôle d'un compte", async ({ page }) => {
  test.setTimeout(120_000);
  expect(await roleOfRecruit()).toBe("warehouse");
  await loginThroughForm(page, DEMO_ACCOUNTS.admin.username, DEMO_ACCOUNTS.admin.password);

  await page.getByText("Administration", { exact: true }).first().click();
  await beat(page, 800);
  await page.getByRole("link", { name: "Utilisateurs" }).first().click();
  await expect(page).toHaveURL(/\/admin\/users/, { timeout: 30_000 });
  const row = page.locator("tr", { hasText: DEMO_ACCOUNTS.recruit.username });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await beat(page, 2000);

  await row.getByTitle("Modifier").click();
  const dialog = page.getByRole("dialog", { name: "Modifier l'utilisateur" });
  await expect(dialog).toBeVisible();
  await beat(page, 1500);
  await dialog.getByRole("combobox").click();
  await beat(page, 800);
  await page.getByRole("option", { name: "Technicien", exact: true }).click();
  await beat(page, 1500);
  await dialog.getByRole("button", { name: "Mettre à jour" }).click();
  await expect.poll(roleOfRecruit, { timeout: 30_000 }).toBe("technician");
  await beat(page, 3000);
});
