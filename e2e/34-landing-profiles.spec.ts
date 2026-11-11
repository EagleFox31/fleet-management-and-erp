import { expect, test } from "@playwright/test";

/**
 * Landing, section « profils » : familles dans l'ordre métier, vignette fixe (image, pas de vidéo
 * lancée sur la carte) qui ouvre la fenêtre sur la vidéo, chapitres de la démo logistique, et aucun
 * défilement horizontal sur mobile.
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

test("la vignette ouvre la fenêtre sur la vidéo, chapitre 2 à 1:48", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByTestId("button-demo-logistics");
  await demo.scrollIntoViewIfNeeded({ timeout: 60_000 });
  // Vignette = bouton portant une image fixe, aucune vidéo dans la carte.
  await expect(demo).toHaveAccessibleName(/^Voir la démo du profil Logisticien, \d+ min$/);
  await expect(demo.locator("img")).toHaveAttribute("src", "/demos/posters/logistics.webp");
  await expect(demo.locator("img")).toHaveAttribute("loading", "lazy");
  await expect(page.getByTestId("badge-demo-duration-logistics")).toHaveText(/^\d+ min$/);
  await expect(page.getByTestId("card-profile-logistics").locator("video")).toHaveCount(0);
  await expect(page.locator("#profiles").getByText(/Voir la démo ·/)).toHaveCount(0);
  const box = await demo.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await demo.click();
  const video = page.getByTestId("video-demo-logistics");
  await expect(video).toBeVisible();
  await expect(video).toBeFocused();
  await expect(video).toHaveAttribute("poster", "/demos/posters/logistics.webp");
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

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`${viewport.width} px : l'en-tête occupe toute la largeur de la fenêtre`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const header = page.locator("header").first();
    await header.waitFor({ timeout: 60_000 });
    const widths = await header.evaluate((el) => ({
      header: Math.round(el.getBoundingClientRect().width),
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.header).toBe(widths.viewport);
  });
}

test("1440 px : les cartes d'une même ligne ont la même hauteur, d'une famille à l'autre", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const cards = page.locator("[data-testid^=card-profile-]");
  await cards.first().scrollIntoViewIfNeeded({ timeout: 60_000 });
  // Les cartes apparaissent au défilement (décalage vertical animé) : les faire toutes entrer, puis attendre la fin.
  const count = await cards.count();
  for (let i = 0; i < count; i++) await cards.nth(i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);

  const boxes = await cards.evaluateAll((elements) =>
    elements.map((el) => {
      const rect = el.getBoundingClientRect();
      return { id: el.getAttribute("data-testid"), top: Math.round(rect.top + window.scrollY), height: rect.height };
    }),
  );
  const rows = new Map<number, typeof boxes>();
  for (const box of boxes) {
    const key = [...rows.keys()].find((top) => Math.abs(top - box.top) <= 1) ?? box.top;
    rows.set(key, [...(rows.get(key) ?? []), box]);
  }
  // 1440 px : quatre colonnes, donc des lignes de plusieurs cartes issues de familles différentes.
  expect([...rows.values()].some((row) => row.length >= 4)).toBe(true);
  for (const row of rows.values()) {
    const heights = row.map((box) => box.height);
    expect(Math.max(...heights) - Math.min(...heights), JSON.stringify(row)).toBeLessThanOrEqual(1);
  }
});
