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
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"),
    page.getByTestId("button-submit-login").click(),
  ]);
  expect(response.ok(), `connexion ${username}`).toBeTruthy();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
  await beat(page, 1500);
}
