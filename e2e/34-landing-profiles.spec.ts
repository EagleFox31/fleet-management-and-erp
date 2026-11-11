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

  test(`${viewport.width} px : la route est dans le fondu vers les profils, sur toute la largeur, sans masquer le titre`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const road = page.locator("#profiles [data-testid=section-divider][data-variant=road]");
    await road.waitFor({ state: "attached", timeout: 60_000 });
    await expect(road).toHaveAttribute("aria-hidden", "true");
    await expect(road.locator("svg path.landing-road-dash")).toHaveCount(1);
    expect(await road.locator("img, video").count()).toBe(0);
    const layout = await road.evaluate((el) => {
      const section = document.getElementById("profiles")!;
      const badge = section.querySelector("h2")!.previousElementSibling as HTMLElement;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        viewport: document.documentElement.clientWidth,
        text: el.textContent?.trim() ?? "",
        roadBottom: rect.bottom,
        badgeTop: badge.getBoundingClientRect().top,
        sectionBorderTop: getComputedStyle(section).borderTopWidth,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.width).toBe(layout.viewport);
    expect(layout.text).toBe("");
    expect(layout.roadBottom).toBeLessThanOrEqual(layout.badgeTop);
    expect(layout.sectionBorderTop).toBe("0px");
    expect(layout.overflowX).toBe(0);
  });

  test(`${viewport.width} px : chaque frontière a son motif pleine largeur, aucune section n'a de bordure haute`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.locator("footer").waitFor({ state: "attached", timeout: 60_000 });
    const junctions = await page.evaluate(() => {
      const topLevel = [...document.querySelectorAll("section, footer")].filter(
        (el) => el.parentElement?.closest("section, footer") === null,
      ) as HTMLElement[];
      // Premier contenu visible : texte (feuille) ou bloc bordé, hors calques décoratifs.
      const firstContentTop = (section: HTMLElement) => {
        const tops = [...section.querySelectorAll<HTMLElement>(".container *")]
          .filter((el) => !el.closest("[aria-hidden=true]") && el.getBoundingClientRect().height > 0)
          .filter((el) => (el.children.length === 0 && el.textContent?.trim()) || parseFloat(getComputedStyle(el).borderTopWidth) > 0)
          .map((el) => el.getBoundingClientRect().top);
        return Math.min(...tops);
      };
      return topLevel.map((section) => {
        const divider = section.querySelector<HTMLElement>(":scope > [data-testid=section-divider]");
        const style = getComputedStyle(section);
        const rect = divider?.getBoundingClientRect();
        return {
          section: section.id || section.tagName.toLowerCase(),
          borderTop: parseFloat(style.borderTopWidth),
          variant: divider?.dataset.variant ?? null,
          width: rect ? Math.round(rect.width) : null,
          ariaHidden: divider?.getAttribute("aria-hidden") ?? null,
          text: divider?.textContent?.trim() ?? "",
          overlap: rect ? rect.bottom - firstContentTop(section) : null,
        };
      });
    });
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const byVariant = Object.fromEntries(junctions.filter((j) => j.variant).map((j) => [j.variant, j]));
    // Ordre métier des frontières : profils (route), avant / après (GPS), fonctionnalités (pneu), résultats (courbe), appel final (arrivée).
    expect(junctions.filter((j) => j.variant).map((j) => j.variant)).toEqual(["road", "gps", "tire", "chart", "finish"]);
    expect(byVariant.chart.section).toBe("stats");
    expect(byVariant.finish.section).toBe("cta");
    for (const junction of junctions) {
      expect(junction.borderTop, junction.section).toBe(0);
      if (!junction.variant) continue;
      expect(junction.width, junction.section).toBe(viewportWidth);
      expect(junction.ariaHidden, junction.section).toBe("true");
      expect(junction.text, junction.section).toBe("");
      expect(junction.overlap!, junction.section).toBeLessThanOrEqual(0);
    }
    expect(junctions.find((j) => j.section === "footer")?.variant).toBeNull();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}

test("séparateurs : les animations tournent, et s'arrêtent sous prefers-reduced-motion", async ({ page }) => {
  const animations = () =>
    page.locator(".landing-road-dash, .landing-divider-pulse").evaluateAll((elements) =>
      elements.map((el) => getComputedStyle(el).animationName),
    );
  await page.goto("/");
  await page.locator("#profiles [data-testid=section-divider]").waitFor({ state: "attached", timeout: 60_000 });
  const running = await animations();
  // Route du haut, trace GPS, courbe, route d'arrivée : une animation chacun.
  expect(running.length).toBe(4);
  expect(running.every((name) => name.startsWith("landing-"))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(new Set(await animations())).toEqual(new Set(["none"]))
});

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
