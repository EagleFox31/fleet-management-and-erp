import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { vehicles } from "../../shared/schema";
import { beat, loginThroughForm } from "./helpers";
import { DEMO_ACCOUNTS, DEMO_VEHICLES } from "./seed-demo";

/**
 * Démo « client » (donneur d'ordre) : tableau de bord, ses véhicules en consultation,
 * et la preuve de cloison : le véhicule d'un autre client est refusé (403, AGENTS.md §11).
 */
test("démo client : ses véhicules en consultation, jamais ceux d'un autre client", async ({ page }) => {
  test.setTimeout(180_000);
  const [foreign] = await db.select().from(vehicles).where(eq(vehicles.registrationNumber, DEMO_VEHICLES.clientB1));
  expect(foreign, "véhicule de l'autre client (seed de démo)").toBeTruthy();

  await loginThroughForm(page, DEMO_ACCOUNTS.clientA.username, DEMO_ACCOUNTS.clientA.password);
  await expect(page.getByTestId("client-kpi-vehicles")).toBeVisible({ timeout: 30_000 });
  await beat(page, 2000);

  await page.getByRole("link", { name: /Mes véhicules|Véhicules/ }).first().click();
  await expect(page.getByText(DEMO_VEHICLES.clientA1).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DEMO_VEHICLES.clientA2).first()).toBeVisible();
  await expect(page.getByText(DEMO_VEHICLES.clientB1, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter un véhicule" })).toHaveCount(0);
  await beat(page, 2500);

  await page.getByText(DEMO_VEHICLES.clientA1).first().click();
  await expect(page).toHaveURL(new RegExp(`/vehicles/${DEMO_VEHICLES.clientA1}$`), { timeout: 30_000 });
  await expect(page.getByText(DEMO_VEHICLES.clientA1).first()).toBeVisible();
  await beat(page, 2500);

  // Preuve de cloison : aucun lien ne mène au véhicule de l'autre client, on l'ouvre par son adresse.
  const refused = page.waitForResponse((r) => r.url().endsWith(`/api/vehicles/${foreign.id}`) && r.request().method() === "GET");
  await page.goto(`/vehicles/${foreign.id}`, { waitUntil: "domcontentloaded" });
  expect((await refused).status()).toBe(403);
  await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DEMO_VEHICLES.clientB1)).toHaveCount(0);
  await beat(page, 3000);
});
