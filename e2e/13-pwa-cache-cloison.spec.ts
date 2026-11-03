import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Cloison du cache hors ligne de la PWA par utilisateur (lot CDC-10a).
 *
 * Deux comptes se succèdent sur le même navigateur : après la déconnexion de A et
 * la connexion de B, B ne doit rien lire de A, ni dans Cache Storage, ni dans
 * IndexedDB, ni dans le cache TanStack Query.
 *
 * Ce spec ne touche aucune base : toute l'API `/api/**` est simulée par
 * `context.route`, y compris l'authentification. Il se lance donc contre un
 * simple serveur Vite du client (`E2E_BASE_URL`), sans `DATABASE_URL`, sans compte
 * réel et sans risque pour la recette ou la production.
 *
 * Sans `E2E_BASE_URL`, Playwright démarrerait le serveur complet (`npm run dev`)
 * sur la `DATABASE_URL` du poste : le spec est alors ignoré.
 */

test.skip(
  !process.env.E2E_BASE_URL,
  "E2E_BASE_URL absent : lancer un serveur Vite seul (sans DATABASE_URL) et le désigner par E2E_BASE_URL",
);

interface MockUser {
  id: number;
  username: string;
  name: string;
  email: string;
  role: "technician";
  password: string;
  workOrderTitle: string;
}

const USER_A: MockUser = {
  id: 9101,
  username: "mock_tech_a",
  name: "Technicien Alpha",
  email: "alpha@example.test",
  role: "technician",
  password: "mock-pass-a",
  workOrderTitle: "OT-ALPHA-CONFIDENTIEL",
};

const USER_B: MockUser = {
  id: 9102,
  username: "mock_tech_b",
  name: "Technicien Bravo",
  email: "bravo@example.test",
  role: "technician",
  password: "mock-pass-b",
  workOrderTitle: "OT-BRAVO-PROPRE",
};

const FLEET_STATS_MARKER = 4242; // donnée hors liste blanche : ne doit jamais être persistée

interface MockServer {
  /** Quand vrai, la liste des OT du technicien échoue comme hors ligne. */
  setOffline(value: boolean): void;
  /** Quand vrai, toute requête /api échoue (appareil sans réseau). */
  setNetworkDown(value: boolean): void;
  /** Compte dont la session est ouverte côté serveur simulé (cookie), sinon null. */
  sessionUserId(): number | null;
  /** Requêtes /api reçues, dans l'ordre ("POST /api/auth/logout" ...). */
  requests: string[];
}

async function mockApi(context: BrowserContext): Promise<MockServer> {
  let current: MockUser | null = null;
  let offline = false;
  let networkDown = false;
  const requests: string[] = [];
  const users = [USER_A, USER_B];
  const publicUser = (u: MockUser) => ({ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role });

  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (networkDown) return route.abort("internetdisconnected");
    requests.push(`${request.method()} ${pathName}`);

    if (pathName === "/api/auth/login" && request.method() === "POST") {
      const body = request.postDataJSON() as { username?: string; password?: string };
      const user = users.find((u) => u.username === body.username && u.password === body.password);
      if (!user) return json(401, { message: "Identifiants invalides", code: "UNAUTHORIZED" });
      current = user;
      return json(200, publicUser(user));
    }
    if (pathName === "/api/auth/me") {
      return current ? json(200, publicUser(current)) : json(401, { message: "Non authentifié" });
    }
    if (pathName === "/api/auth/logout") {
      current = null;
      return json(200, { ok: true });
    }
    if (!current) return json(401, { message: "Non authentifié" });

    if (pathName === "/api/technician/my-work-orders") {
      if (offline) return route.abort("internetdisconnected");
      const workOrders = [
        {
          id: current.id,
          vehicleId: 13,
          title: current.workOrderTitle,
          status: "in_progress",
          priority: "high",
          vehicleRegistrationNumber: "TEST-0000",
          createdAt: new Date().toISOString(),
        },
      ];
      return json(200, {
        workOrders,
        stats: { pending: 0, inProgress: 1, completed: 0, total: 1 },
        total: 1,
      });
    }
    if (pathName === "/api/statistics/fleet") {
      return json(200, { operational: FLEET_STATS_MARKER, maintenance: 0, outOfService: 0 });
    }
    // Tout le reste (notifications, alertes, ...) : réponse vide valide.
    return json(200, request.method() === "GET" ? [] : {});
  });

  return {
    setOffline(value) {
      offline = value;
    },
    setNetworkDown(value) {
      networkDown = value;
    },
    sessionUserId: () => current?.id ?? null,
    requests,
  };
}

async function loginThroughUi(page: Page, user: MockUser): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("input-username").fill(user.username);
  await page.getByTestId("input-password").fill(user.password);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"),
    page.getByTestId("button-submit-login").click(),
  ]);
}

async function logoutThroughUi(page: Page, user: MockUser): Promise<void> {
  await page.getByRole("button", { name: new RegExp(user.name) }).first().click();
  await page.getByRole("menuitem", { name: /Déconnexion/ }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Contenu brut de toutes les bases `fleetos-offline-u*` et du store par défaut d'idb-keyval. */
async function readIndexedDb(page: Page) {
  return page.evaluate(async () => {
    const openDb = (name: string, createStore?: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onupgradeneeded = () => {
          if (createStore && !req.result.objectStoreNames.contains(createStore)) req.result.createObjectStore(createStore);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const dumpStore = (db: IDBDatabase, store: string) =>
      new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const tx = db.transaction(store, "readonly");
        const os = tx.objectStore(store);
        const keysReq = os.getAllKeys();
        const valuesReq = os.getAll();
        tx.oncomplete = () =>
          resolve(keysReq.result.map((key, i) => ({ key: String(key), value: valuesReq.result[i] })));
        tx.onerror = () => reject(tx.error);
      });

    const names = ((await indexedDB.databases?.()) ?? [])
      .map((d) => d.name ?? "")
      .filter((n) => /^fleetos-offline-u\d+$/.test(n));
    const offline: Record<string, Array<{ key: string; value: unknown }>> = {};
    for (const name of names) {
      const db = await openDb(name);
      offline[name] = await dumpStore(db, "kv");
      db.close();
    }
    const legacyDb = await openDb("keyval-store", "keyval");
    const legacy = await dumpStore(legacyDb, "keyval");
    legacyDb.close();
    return { offline, legacy };
  });
}

/** Tout ce que Cache Storage contient : nom du cache -> URLs. */
async function readCacheStorage(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      result[name] = (await cache.keys()).map((r) => r.url);
    }
    return result;
  });
}

test.describe("Cloison du cache hors ligne par utilisateur", () => {
  test("A déconnecté, B hors ligne ne lit rien de A (Cache Storage, IndexedDB, cache TanStack)", async ({ page, context }) => {
    const api = await mockApi(context);

    // --- A travaille : sa liste d'OT s'affiche puis est persistée ---
    await loginThroughUi(page, USER_A);
    await expect(page.getByText(USER_A.workOrderTitle).first()).toBeVisible({ timeout: 60_000 });

    const storeA = `fleetos-offline-u${USER_A.id}`;
    await expect
      .poll(async () => JSON.stringify((await readIndexedDb(page)).offline[storeA] ?? []), {
        message: "la liste d'OT de A est persistée dans son magasin",
        timeout: 20_000,
      })
      .toContain(USER_A.workOrderTitle);

    // Liste blanche : la donnée hors périmètre (statistiques de la flotte) n'est pas persistée.
    const persisted = JSON.stringify((await readIndexedDb(page)).offline);
    expect(persisted).not.toContain("/api/statistics/fleet");
    expect(persisted).not.toContain(String(FLEET_STATS_MARKER));

    // Aucune réponse /api/* dans Cache Storage, quoi qu'ait fait le service worker.
    for (const urls of Object.values(await readCacheStorage(page))) {
      expect(urls.filter((u) => new URL(u).pathname.startsWith("/api/"))).toEqual([]);
    }

    // --- Déconnexion de A : tout est purgé ---
    await logoutThroughUi(page, USER_A);
    const afterLogout = await readIndexedDb(page);
    expect(JSON.stringify(afterLogout)).not.toContain(USER_A.workOrderTitle);
    for (const records of Object.values(afterLogout.offline)) expect(records).toEqual([]);
    expect(afterLogout.legacy).toEqual([]);

    // --- B se connecte, sa liste d'OT est injoignable (hors ligne) ---
    api.setOffline(true);
    await loginThroughUi(page, USER_B);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
    await page.waitForTimeout(3_000); // laisse les requêtes échouer et le rendu se stabiliser

    // Le cache TanStack n'a pas conservé la liste de A (même clé de requête, autre utilisateur).
    await expect(page.locator("body")).not.toContainText(USER_A.workOrderTitle);
    // Ni Cache Storage ni IndexedDB ne contiennent quoi que ce soit de A.
    const forB = await readIndexedDb(page);
    expect(JSON.stringify(forB)).not.toContain(USER_A.workOrderTitle);
    expect(JSON.stringify(forB)).not.toContain(USER_A.name);
    expect(Object.keys(forB.offline).filter((n) => (forB.offline[n] ?? []).length > 0)).not.toContain(storeA);
    expect(JSON.stringify(await readCacheStorage(page))).not.toContain("/api/technician");

    // Retour du réseau : B lit ses propres données, pas celles de A.
    api.setOffline(false);
    await page.reload();
    await expect(page.getByText(USER_B.workOrderTitle).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).not.toContainText(USER_A.workOrderTitle);
  });

  test("un ancien cache API déjà stocké est supprimé à l'activation du nouveau service worker", async ({ page, context }) => {
    await mockApi(context);
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // Le navigateur de test n'a pas d'ancienne version : on la reconstitue.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const old = await caches.open("fleetos-tech-v1.0.0");
      await old.put(
        new Request(`${location.origin}/api/technician/my-work-orders`),
        new Response(JSON.stringify({ workOrders: [{ title: "OT-ANCIEN-CACHE" }] })),
      );
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    });
    expect(Object.keys(await readCacheStorage(page))).toContain("fleetos-tech-v1.0.0");

    // Rechargement : le worker s'installe et s'active de nouveau.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(async () => Object.keys(await readCacheStorage(page)), {
        message: "seul le cache statique courant subsiste",
        timeout: 30_000,
      })
      .toEqual(["fleetos-static-v2"]);
    expect(JSON.stringify(await readCacheStorage(page))).not.toContain("/api/");
  });

  test("l'ancien format global d'IndexedDB est détruit à la connexion", async ({ page, context }) => {
    await mockApi(context);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("keyval-store");
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("keyval")) req.result.createObjectStore("keyval");
          };
          req.onsuccess = () => {
            const tx = req.result.transaction("keyval", "readwrite");
            tx.objectStore("keyval").put({ queries: [{ title: "OT-ANCIEN-FORMAT" }] }, "fleetos-query-cache-v1");
            tx.objectStore("keyval").put([{ label: "ancienne file" }], "fleetos-offline-queue-v1");
            tx.oncomplete = () => {
              req.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    expect((await readIndexedDb(page)).legacy.length).toBe(2);

    await loginThroughUi(page, USER_A);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });

    await expect.poll(async () => (await readIndexedDb(page)).legacy, { timeout: 15_000 }).toEqual([]);
  });

  test("déconnexion hors ligne : le serveur est prévenu au retour du réseau (événement online)", async ({ page, context }) => {
    const api = await mockApi(context);
    await loginThroughUi(page, USER_A);
    await expect(page).not.toHaveURL(/\/login/,{ timeout: 30_000 });

    // Plus de réseau : la déconnexion n'atteint pas le serveur, la session serveur reste ouverte.
    api.setNetworkDown(true);
    await context.setOffline(true);
    await logoutThroughUi(page, USER_A);
    expect(api.sessionUserId()).toBe(USER_A.id);
    expect(await page.evaluate(() => localStorage.getItem("fleetos-pending-server-logout"))).not.toBeNull();
    const afterLogout = await readIndexedDb(page);
    for (const records of Object.values(afterLogout.offline)) expect(records).toEqual([]);

    // Retour du réseau : la déconnexion en attente part, le cookie ne reconnecte plus A.
    api.setNetworkDown(false);
    await context.setOffline(false);
    await expect.poll(() => api.sessionUserId(), { timeout: 15_000 }).toBeNull();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("fleetos-pending-server-logout")), { timeout: 10_000 })
      .toBeNull();
  });

  test("déconnexion hors ligne puis redémarrage : /api/auth/logout part avant /api/auth/me, qui répond 401", async ({ page, context }) => {
    const api = await mockApi(context);
    await loginThroughUi(page, USER_A);
    await expect(page).not.toHaveURL(/\/login/,{ timeout: 30_000 });

    api.setNetworkDown(true);
    await context.setOffline(true);
    await logoutThroughUi(page, USER_A);
    expect(api.sessionUserId()).toBe(USER_A.id);
    await page.close(); // l'application est fermée avant le retour du réseau : pas d'événement online

    api.setNetworkDown(false);
    await context.setOffline(false);
    api.requests.length = 0;

    const restarted = await context.newPage();
    const meResponse = restarted.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/me");
    await restarted.goto("/", { waitUntil: "domcontentloaded" });

    expect((await meResponse).status()).toBe(401);
    await restarted.waitForTimeout(3_000); // laisse l'application finir son amorçage
    await expect(restarted.getByRole("button", { name: new RegExp(USER_A.name) })).toHaveCount(0);
    const logoutAt = api.requests.indexOf("POST /api/auth/logout");
    const meAt = api.requests.indexOf("GET /api/auth/me");
    expect(logoutAt).toBeGreaterThanOrEqual(0);
    expect(meAt).toBeGreaterThan(logoutAt);
    expect(api.sessionUserId()).toBeNull();
  });
});
