import { expect, test } from "@playwright/test";
import { beat, loginThroughForm } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, seedDemo } from "./seed-demo";

/**
 * Démo « direction » : tableau de bord et indicateurs, corridors CEMAC, puis les rapports
 * (board pack, trésorerie et recouvrement, audit flotte et TCO). Lecture seule.
 */
test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

test("démo direction : tableau de bord, corridors CEMAC et rapports", async ({ page }) => {
  test.setTimeout(150_000);
  await loginThroughForm(page, DEMO_ACCOUNTS.management.username, DEMO_ACCOUNTS.management.password);

  await expect(page.getByTestId("kpi-tiles")).toBeVisible({ timeout: 30_000 });
  await beat(page, 2500);

  await page.getByRole("link", { name: "Corridors CEMAC" }).first().click();
  await expect(page).toHaveURL(/\/management\/corridor-map/, { timeout: 30_000 });
  await beat(page, 3000);

  await page.getByRole("button", { name: "Rapports Direction" }).first().click();
  await page.getByRole("link", { name: "Board Pack Stratégique" }).first().click();
  await expect(page).toHaveURL(/\/management\/reports\/board-pack/, { timeout: 30_000 });
  await beat(page, 3000);
  for (const label of ["Trésorerie & Recouvrement", "Audit Flotte & TCO"]) {
    await page.getByRole("tab", { name: label }).click();
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Accès refusé")).toHaveCount(0);
    if (label.startsWith("Audit")) {
      // La mission terminée du seed donne un camion sous TCO et une marge non nulle.
      await expect(page.getByText(/^[1-9]\d* camions?/).first()).toBeVisible();
    }
    if (label.startsWith("Trésorerie")) {
      // La base de test est partagée : on vérifie des montants non nuls, pas un total exact.
      await expect(page.getByText(/[1-9][0-9.\s]*FCFA/).first()).toBeVisible();
    }
    await beat(page, 3000);
  }
});
