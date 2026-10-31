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
  // Le service worker PWA répond à la place du réseau : sans ce blocage, page.route ne voit rien.
  test.describe(() => {
    test.use({ serviceWorkers: "block" });

    test("serveur lent : la session est conservée, pas de renvoi vers la connexion", async ({ page }) => {
      await login(page);

      // Le contrôle de session échoue (503, puis coupure réseau) tant que le panneau
      // d'attente n'a pas été vu : avant le correctif, l'utilisateur partait sur /login.
      let failures = 0;
      let serverDown = true;
      await page.route("**/api/auth/me", async (route) => {
        if (!serverDown) return route.continue();
        failures += 1;
        return failures % 2 === 1 ? route.fulfill({ status: 503, body: "{}" }) : route.abort("connectionreset");
      });

      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("session-unreachable")).toBeVisible({ timeout: 60_000 });
      await expect(page).not.toHaveURL(/\/login/);
      serverDown = false;

      await expect(page.getByTestId("menu-dashboard")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("session-unreachable")).toHaveCount(0);
      await expect(page).toHaveURL(/\/dashboard$/);
      expect(failures).toBeGreaterThanOrEqual(1);
    });
  });
});
