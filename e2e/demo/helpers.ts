import { expect, type Page } from "@playwright/test";

/** Pause lisible à l'écran entre deux étapes visibles (vidéo de démonstration). */
export function beat(page: Page, ms = 800): Promise<void> {
  return page.waitForTimeout(ms);
}

/**
 * Connexion par le formulaire, visible dans la vidéo (les specs standard passent par
 * l'API pour gagner du temps ; ici la connexion fait partie du parcours montré).
 */
export async function loginThroughForm(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-username").fill(username);
  await beat(page, 500);
  await page.getByTestId("input-password").fill(password);
  await beat(page, 500);
  // Au premier chargement après le démarrage du serveur, un clic peut précéder l'attache du
  // gestionnaire du formulaire : sans réponse sous 15 s, on clique à nouveau (3 essais).
  let response: Awaited<ReturnType<Page["waitForResponse"]>> | undefined;
  for (let attempt = 1; attempt <= 3 && !response; attempt++) {
    try {
      [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST", { timeout: 15_000 }),
        page.getByTestId("button-submit-login").click(),
      ]);
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  expect(response!.ok(), `connexion ${username}`).toBeTruthy();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
  await beat(page, 1500);
}

/** Déconnexion par le menu utilisateur de la barre du haut (visible dans la vidéo). */
export async function logoutThroughUi(page: Page, displayName: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(displayName) }).first().click();
  await beat(page, 600);
  await page.getByRole("menuitem", { name: /Déconnexion/ }).click();
  await expect(page).toHaveURL(/\/(login)?$/, { timeout: 30_000 });
  await beat(page, 1000);
}
