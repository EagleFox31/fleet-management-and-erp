import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, missions, users, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";

/**
 * V5b-3c : tableau chauffeur en lecture seule après une reprise hors ligne.
 *
 * Le rechargement se joue sous `context.setOffline(true)` : la coupure est réseau (pas une interception
 * `page.route`), donc c'est le service worker qui sert la coquille de l'application. Ce spec ne prouve rien
 * sans lui : il exige un build de production (`vite build`) servi par le serveur complet
 * (`E2E_BASE_URL`, drapeaux `FEATURE_FLAGS=driver-offline=on,offline-writes=on`), sur une base locale.
 *
 * Seules les missions `in_progress` et `delivered` sont lisibles hors ligne (décision 3 de V5b) : la mission
 * de test est donc `in_progress`.
 *
 * Données préfixées E2E-V5B3C-, supprimées en fin de spec (et à l'ouverture si un run a planté).
 */

test.skip(
  !process.env.E2E_BASE_URL,
  "E2E_BASE_URL absent : lancer le build de production (service worker) et le désigner par E2E_BASE_URL",
);

const PREFIX = "E2E-V5B3C-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

let driver: E2ECredentials & { id: number };
let orderNumber: string;
let denied: E2ECredentials & { id: number };

async function purge(): Promise<void> {
  const missionRows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`));
  const missionIds = missionRows.map((row) => row.id);
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  const vehicleRows = await db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`));
  const vehicleIds = vehicleRows.map((row) => row.id);
  if (vehicleIds.length > 0) await db.delete(assignments).where(inArray(assignments.vehicleId, vehicleIds));
  await db.delete(drivers).where(like(drivers.lastName, `${PREFIX}%`));
  const bag = createIdBag();
  bag.vehicleIds.push(...vehicleIds);
  bag.clientIds.push(...(await db.select({ id: clients.id }).from(clients).where(like(clients.name, `${PREFIX}%`))).map((r) => r.id));
  bag.userIds.push(...(await db.select({ id: users.id }).from(users).where(like(users.username, `${PREFIX}%`))).map((r) => r.id));
  await cleanupCreated(bag);
}

async function createAccount(role: TestUserRole, label: string): Promise<E2ECredentials & { id: number }> {
  const name = token(label);
  const user = await createTestUser({ role, username: name, name, email: `${name.toLowerCase()}@fleet.test` });
  ids.userIds.push(user.id);
  return { id: user.id, username: user.username, password: TEST_USER_PASSWORD, label };
}

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  driver = await createAccount("driver", "CHAUFFEUR");
  denied = await createAccount("workshop_manager", "ATELIER");
  const [row] = await db
    .insert(drivers)
    .values({ userId: driver.id, firstName: "Chauffeur", lastName: token("DRV"), employeeNumber: token("EMP"), isActive: true })
    .returning();
  const vehicle = await createTestVehicle({ registrationNumber: `${PREFIX}V${Date.now().toString(36)}`.slice(0, 32) });
  ids.vehicleIds.push(vehicle.id);
  orderNumber = token("MIS");
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber, status: "in_progress", pickupAddress: "Douala, port", deliveryAddress: "Yaoundé, entrepôt" })
    .returning();
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: row.id, status: "accepted" });
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

/** Erreurs de page, ajoutées au message d'échec des attentes du voile. */
const problems: string[] = [];

const WRITE_BUTTONS = ["Signaler un problème", "Enregistrer un plein"];

/**
 * Attend que le service worker contrôle la page, SANS rechargement : depuis V5b-3d il précache toute la coquille à
 * l'installation et prend le contrôle à l'activation (clients.claim). Jamais de vert sans service worker.
 */
async function waitForServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 60_000,
      message: "le service worker ne contrôle pas la page (build sans service worker ?)",
    })
    .toBe(true);
}

/** Session ouverte par l'API, tableau chargé, service worker aux commandes, copie hors ligne écrite. */
async function openOnline(browser: Browser, credentials: E2ECredentials, userId: number, expectMission: boolean): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newE2EContext(browser, "profil");
  const page = await context.newPage();
  problems.length = 0;
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`.slice(0, 300)));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`.slice(0, 300));
  });
  await loginWithSession(page, credentials);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (expectMission) await expect(page.getByText(`#${orderNumber}`)).toBeVisible({ timeout: 60_000 });
  await waitForServiceWorker(page);
  // Marqueur de reprise écrit après /api/auth/me, copie de lecture du compte écrite après les lectures.
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name);
          return names.includes("fleetos-offline-resume") && (!id || names.includes(`fleetos-offline-u${id}`));
        }, expectMission ? userId : 0),
      { timeout: 60_000, message: "marqueur de reprise ou copie de lecture absents" },
    )
    .toBe(true);
  // Sauvegarde de la copie de lecture : debounce de 2 s après la dernière modification du cache.
  await page.waitForTimeout(4_000);
  return { context, page };
}

test.describe("V5b-3c : reprise hors ligne du tableau chauffeur", () => {
  test("rechargement sous setOffline : tableau en lecture seule, bandeau, aucune écriture, puis retour du réseau", async ({ browser }) => {
    const { context, page } = await openOnline(browser, driver, driver.id, true);
    try {
      await context.setOffline(true);
      // Hors ligne, aucune requête d'écriture (POST, PUT, PATCH, DELETE) ne doit partir, en plus de l'absence de boutons.
      const writes: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET" && request.method() !== "HEAD" && request.method() !== "OPTIONS") {
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });
      await page.reload({ waitUntil: "domcontentloaded" });

      await expect(page.getByText(`#${orderNumber}`), `erreurs de page : ${problems.join(" | ")}`).toBeVisible({ timeout: 60_000 });
      const banner = page.getByTestId("offline-data-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Hors ligne");
      await expect(banner).toContainText("Consultation seule jusqu'au");
      await expect(page.getByTestId("session-unreachable")).toHaveCount(0);
      for (const name of WRITE_BUTTONS) await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
      expect(writes, "requêtes d'écriture parties hors ligne").toEqual([]);
      // Autre URL : renvoi vers l'accueil du profil (shell restreint).
      await page.evaluate(() => window.history.pushState({}, "", "/maintenance/work-orders"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/(?:\?.*)?$/);
      await expect(page.getByText(`#${orderNumber}`)).toBeVisible({ timeout: 60_000 });

      // Retour du réseau : /me répond, les écritures reviennent.
      await context.setOffline(false);
      await expect(page.getByRole("button", { name: "Signaler un problème" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("offline-data-banner")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("déconnexion puis rechargement hors ligne : écran de connexion, aucune lecture du compte", async ({ browser }) => {
    const { context, page } = await openOnline(browser, driver, driver.id, true);
    try {
      await page.getByRole("button", { name: "Se déconnecter" }).click();
      await expect(page.getByText(`#${orderNumber}`)).toHaveCount(0, { timeout: 60_000 });
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("input-username")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(`#${orderNumber}`)).toHaveCount(0);
      await expect(page.getByTestId("offline-data-banner")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("marqueur expiré (horloge à +73 h) : pas de reprise, voile d'attente", async ({ browser }) => {
    const { context, page } = await openOnline(browser, driver, driver.id, true);
    try {
      await context.setOffline(true);
      await page.clock.install({ time: new Date(Date.now() + 73 * 3600_000) });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("session-unreachable"), `erreurs de page : ${problems.join(" | ")}`).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(`#${orderNumber}`)).toHaveCount(0);
      await expect(page.getByTestId("offline-data-banner")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("rôle sans reprise (chef d'atelier) : pas de tableau hors ligne", async ({ browser }) => {
    const { context, page } = await openOnline(browser, denied, denied.id, false);
    try {
      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("session-unreachable"), `erreurs de page : ${problems.join(" | ")}`).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("offline-data-banner")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
