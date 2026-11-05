import { expect, test } from "@playwright/test";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS } from "./seed-demo";

/**
 * Démo « direction » : tableau de bord et indicateurs, corridors CEMAC, puis les rapports
 * (board pack, trésorerie et recouvrement, audit flotte et TCO). Lecture seule.
 */
test.beforeAll(() => assertLocalDatabase());

test("démo direction : tableau de bord, corridors CEMAC et rapports", async ({ page }) => {
  test.setTimeout(150_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.management.username, DEMO_ACCOUNTS.management.password);

  await expect(page.getByTestId("kpi-tiles")).toBeVisible({ timeout: 30_000 });
  await beat(page, 2500);

  await page.getByRole("link", { name: "Corridors CEMAC" }).first().click();
  await expect(page).toHaveURL(/\/management\/corridor-map/, { timeout: 30_000 });
  await beat(page, 3000);

  await page.getByText("Rapports Direction", { exact: true }).first().click();
  await page.getByRole("link", { name: "Board Pack Stratégique" }).first().click();
  await expect(page).toHaveURL(//management/reports/board-pack/, { timeout: 30_000 });
  await beat(page, 3000);
  for (const label of ["Trésorerie & Recouvrement", "Audit Flotte & TCO"]) {
    await page.getByRole("tab", { name: label }).click();
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Accès refusé")).toHaveCount(0);
    await beat(page, 3000);
  }
});
