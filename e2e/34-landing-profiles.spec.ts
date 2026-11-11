import { expect, test } from "@playwright/test";

/**
 * Landing, section « profils » : familles dans l'ordre métier, bouton « Voir la démo » qui ouvre
 * la fenêtre sur la vidéo, chapitres de la démo logistique, et aucun défilement horizontal sur mobile.
 * Page publique : aucune connexion.
 */

const FAMILIES = [
  { id: "operations", title: "Exploitation", profiles: ["logistics", "driver"] },
  { id: "workshop", title: "Atelier", profiles: ["workshop_manager", "technician"] },
  { id: "store", title: "Magasin", profiles: ["warehouse"] },
  { id: "management", title: "Gestion et direction", profiles: ["management", "accountant", "secretary"] },
  { id: "access", title: "Accès", profiles: ["client", "viewer", "admin"] },
];

test("profils rangés par famille, dans l'ordre métier", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#profiles");
  await expect(section).toBeVisible({ timeout: 60_000 });

  const families = section.locator("[data-testid^=profile-family-]");
  await expect(families).toHaveCount(FAMILIES.length);
  for (const [index, family] of FAMILIES.entries()) {
    const block = families.nth(index);
    await expect(block).toHaveAttribute("data-testid", `profile-family-${family.id}`);
    await expect(block.getByRole("heading", { level: 3 })).toHaveText(family.title);
    const cards = block.locator("[data-testid^=card-profile-]");
    await expect(cards).toHaveCount(family.profiles.length);
    for (const [cardIndex, profile] of family.profiles.entries()) {
      await expect(cards.nth(cardIndex)).toHaveAttribute("data-testid", `card-profile-${profile}`);
    }
  }

  // Aucun jargon ni libellé technique visible dans la section.
  await expect(section).not.toContainText("RBAC");
  await expect(section).not.toContainText("Rôle système");
  await expect(section.getByText("Au quotidien").first()).toBeVisible();
});

test("« Voir la démo » ouvre la fenêtre sur la vidéo, chapitre 2 à 1:48", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByTestId("button-demo-logistics");
  await demo.scrollIntoViewIfNeeded({ timeout: 60_000 });
  await expect(demo).toHaveAccessibleName(/^Voir la démo du profil Logisticien, \d+ min$/);
  await expect(demo).toContainText(/Voir la démo · \d+ min/);
  const box = await demo.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await demo.click();
  const video = page.getByTestId("video-demo-logistics");
  await expect(video).toBeVisible();
  await expect(video).toBeFocused();
  await video.evaluate((el: HTMLVideoElement) => {
    el.muted = true;
  });

  await page.getByTestId("video-chapter-logistics-2").click();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThanOrEqual(108);
  await expect(page.getByTestId("video-chapter-logistics-2")).toHaveAttribute("aria-pressed", "true");
});

test("un profil sans vidéo n'affiche que le guide ; une vidéo sans chapitres n'a pas de boutons", async ({ page }) => {
  await page.goto("/");
  const adminCard = page.getByTestId("card-profile-admin");
  await adminCard.scrollIntoViewIfNeeded({ timeout: 60_000 });
  await expect(page.getByTestId("button-demo-admin")).toHaveCount(0);
  await expect(page.getByTestId("button-guide-admin")).toBeVisible();

  await page.getByTestId("button-guide-technician").click();
  await expect(page.getByTestId("video-demo-technician")).toBeVisible();
  await expect(page.locator("[data-testid^=video-chapter-technician]")).toHaveCount(0);
});

test("mobile 390 px : pas de défilement horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("card-profile-logistics").scrollIntoViewIfNeeded({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
