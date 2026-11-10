import { expect, test, type Page } from "@playwright/test";

/**
 * V5b-3d : précache de la coquille par le service worker.
 *
 * Première visite, puis coupure réseau IMMÉDIATE (dès que le service worker contrôle la page, sans le
 * rechargement en ligne qu'imposait la spec 21), puis rechargement : la coquille de l'application s'affiche,
 * jamais une page blanche. Ce spec ne prouve rien sans service worker : il exige un build de production
 * (`vite build`, qui injecte la liste des assets dans `sw.js`) servi à `E2E_BASE_URL`, soit par le serveur
 * complet, soit par `node scripts/e2e-static-shell.mjs` (aucune base de données nécessaire : seule la
 * coquille est testée, `/api/*` répond 401).
 *
 * Aucune donnée n'est écrite : pas de compte, pas de base.
 */

test.skip(
  !process.env.E2E_BASE_URL,
  "E2E_BASE_URL absent : lancer le build de production (service worker) et le désigner par E2E_BASE_URL",
);

// Le service worker s'enregistre à l'événement `load`, que retardent les ressources d'autres origines (polices
// Google) quand le poste n'a pas d'accès ou un accès lent : elles sont coupées d'emblée, le test ne mesure que
// la coquille de l'application.
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
});

/** Noms de cache et URL mises en cache, lus depuis la page (même origine que le service worker). */
async function readShellCaches(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
    }
    return out;
  });
}

test.describe("première visite puis coupure immédiate", () => {
  test("le service worker contrôle la page sans rechargement, et la coquille est entière dans son cache", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 60_000 });

    // Contrôle acquis par clients.claim() à l'activation : aucun page.reload() entre les deux.
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 60_000,
        message: "le service worker ne contrôle pas la page (build sans service worker ?)",
      })
      .toBe(true);

    const cached = await readShellCaches(page);
    const names = Object.keys(cached);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^fleetos-shell-[0-9a-f]{10}$/);
    const urls = cached[names[0]];

    // L'index.html et tous les modules, styles et polices chargés par la page y sont.
    expect(urls).toContain("/index.html");
    const loaded = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name))
        .filter((url) => url.origin === location.origin && url.pathname.startsWith("/assets/"))
        .map((url) => url.pathname),
    );
    expect(loaded.length).toBeGreaterThan(0);
    expect(urls).toEqual(expect.arrayContaining(loaded));

    // Cloisonnement : aucune réponse d'API dans la coquille.
    expect(urls.filter((pathname) => /^\/api(\/|$)/i.test(pathname))).toEqual([]);
  });

  test("coupure juste après la première visite : le rechargement affiche l'écran de connexion", async ({ page, context }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`.slice(0, 300)));

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 })
      .toBe(true);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("input-password")).toBeVisible();
    // Ce n'est ni la page d'erreur du navigateur ni une page blanche.
    expect(await page.locator("#root").evaluate((el) => el.children.length)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("hors ligne, une route profonde de l'application sert la coquille", async ({ page, context }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 })
      .toBe(true);

    await context.setOffline(true);
    const response = await page.goto("/missions/12345", { waitUntil: "domcontentloaded" });

    // Servi par le service worker (pas d'erreur réseau) : l'application démarre, et comme /api/auth/me est
    // injoignable sans reprise hors ligne possible, elle affiche son voile d'attente, pas une page blanche.
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Le serveur met du temps à répondre")).toBeVisible({ timeout: 30_000 });
  });

  test("la déconnexion et la purge des données ne touchent pas la coquille", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 })
      .toBe(true);

    const before = await readShellCaches(page);
    // Purge des bases IndexedDB de l'application, comme le fait la déconnexion.
    await page.evaluate(async () => {
      for (const db of (await indexedDB.databases?.()) ?? []) {
        if (db.name?.startsWith("fleetos-")) indexedDB.deleteDatabase(db.name);
      }
    });
    expect(await readShellCaches(page)).toEqual(before);
  });
});
