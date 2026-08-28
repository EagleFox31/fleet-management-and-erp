import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

test.describe("Critical Journey 1 - Auth", () => {
  test("connexion valide + session persistante", async ({ page }) => {
    await login(page);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("menu-dashboard")).toBeVisible();

    // `domcontentloaded` comme toutes les autres navigations de la suite:
    // `page.reload()` attend `load` par défaut, qui n'arrive jamais sur le
    // dashboard en mode dev (modules Vite chargés à la demande).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/dashboard$/);

    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.ok()).toBeTruthy();
  });

  test("identifiants invalides restent sur l'ecran de login", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await page.getByTestId("input-username").fill("invalid-user");
    await page.getByTestId("input-password").fill("invalid-password");
    await page.getByTestId("button-submit-login").click();

    await expect(page).toHaveURL(/\/login$/);

    const meResponse = await page.request.get("/api/auth/me");
    expect(meResponse.status()).toBe(401);
  });
});
