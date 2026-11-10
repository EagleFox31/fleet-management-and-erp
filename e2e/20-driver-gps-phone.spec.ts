import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, missions, users, vehiclePositions, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { apiLogin, loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createLaunchableDriver, createLaunchableVehicle, creditFuelCard, LAUNCH_BUDGETS } from "./helpers/mission-journey";
import { newE2EContext } from "./helpers/contexts";

/**
 * GPS V1 téléphone, côté chauffeur (`client/src/components/driver/driver-gps-panel.tsx`).
 * Le serveur doit tourner avec `FEATURE_FLAGS=gps=on` sur une base locale.
 *
 * Vert : la carte et le lien Itinéraire apparaissent ; le départ confirmé démarre le relevé
 * (géolocalisation simulée), le paquet part en POST JSON et la base reçoit le point ; un point
 * 500 m plus loin s'ajoute ; la livraison confirmée arrête le suivi. Autorisation refusée :
 * message clair, la mission avance. Drapeau coupé : rien n'apparaît, rien ne part. Un compte
 * non chauffeur ne peut pas déposer de position (403).
 * Données préfixées E2E-GPSFE-, supprimées en fin de spec.
 */
const PREFIX = "E2E-GPSFE-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

type Crew = { user: E2ECredentials & { id: number }; missionId: number; orderNumber: string };
let crewMain: Crew;
let crewDenied: Crew;
let crewFlag: Crew;
let logistics: E2ECredentials & { id: number };

async function purge(): Promise<void> {
  const missionRows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${PREFIX}%`));
  const missionIds = missionRows.map((row) => row.id);
  if (missionIds.length > 0) {
    await db.delete(vehiclePositions).where(inArray(vehiclePositions.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await db.delete(drivers).where(like(drivers.lastName, `${PREFIX}%`));
  const bag = createIdBag();
  bag.vehicleIds.push(...(await db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`))).map((r) => r.id));
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

/** Chauffeur, véhicule et mission affectée Douala -> Yaoundé, avec points A/B. */
async function createCrew(label: string, clientId: number): Promise<Crew> {
  const user = await createAccount("driver", label);
  // Papiers valides, CPC formé : le lancement passe par les vraies gardes métier.
  const driver = await createLaunchableDriver(token(label), token(`EMP${label}`));
  await db.update(drivers).set({ userId: user.id }).where(eq(drivers.id, driver.id));
  const vehicle = await createLaunchableVehicle(ids, `${PREFIX}${label}${Date.now().toString(36)}`.slice(0, 32));
  const orderNumber = token(`MIS${label}`);
  const [mission] = await db
    .insert(missions)
    .values({
      clientId,
      orderNumber,
      status: "assigned",
      pickupAddress: "Douala, port",
      deliveryAddress: "Yaoundé, entrepôt",
      pickupLat: 4.0511,
      pickupLng: 9.7679,
      deliveryLat: 3.848,
      deliveryLng: 11.5021,
    })
    .returning();
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "accepted" });
  // Budgets du lancement saisis par la logistique, comme à l'écran.
  const api = await apiLogin(logistics);
  if (!api) throw new Error("connexion logistique refusée");
  const budget = await api.patch(`/api/missions/${mission.id}`, { data: { budget: LAUNCH_BUDGETS } });
  expect(budget.status(), await budget.text()).toBeLessThan(300);
  await api.dispose();
  return { user, missionId: mission.id, orderNumber };
}

async function driverPage(browser: Browser, crew: Crew, options: { geolocation?: { latitude: number; longitude: number }; flags?: boolean } = {}): Promise<Page> {
  const context = await newE2EContext(browser, "chauffeur", {
    viewport: process.env.GPS_E2E_DESKTOP ? { width: 1280, height: 800 } : { width: 390, height: 844 },
    ...(options.geolocation ? { geolocation: options.geolocation, permissions: ["geolocation"] } : {}),
  });
  const page = await context.newPage();
  if (options.flags === false) {
    await page.route("**/api/feature-flags", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, boolean>;
      await route.fulfill({ response, json: { ...body, gps: false } });
    });
  }
  await loginWithSession(page, crew.user);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(`#${crew.orderNumber}`)).toBeVisible({ timeout: 60_000 });
  return page;
}

const positionCount = async (missionId: number) =>
  (await db.select({ id: vehiclePositions.id }).from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId))).length;

/** Clique sur le bouton de statut et exige que le serveur accepte le changement (corps joint en cas d'échec). */
async function changeStatus(page: Page, name: RegExp): Promise<void> {
  const answer = page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/missions\/\d+\/status/.test(r.url()), { timeout: 60_000 });
  await page.getByRole("button", { name }).click();
  const response = await answer;
  // Le corps n'est lu qu'en cas d'échec : le lire sur un succès peut rester suspendu derrière le service worker.
  const detail = response.ok() ? "" : (await response.text()).slice(0, 300);
  expect(response.ok(), `statut mission : ${response.status()} ${detail}`).toBeTruthy();
}

/** Le paquet part toutes les 2 min ; l'événement `online` déclenche le même envoi tout de suite. */
const triggerFlush = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  logistics = await createAccount("logistics", "LOGI");
  await creditFuelCard(ids);
  crewMain = await createCrew("A", client.id);
  crewDenied = await createCrew("B", client.id);
  crewFlag = await createCrew("C", client.id);
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe("GPS V1 téléphone : espace chauffeur", () => {
  test("carte, itinéraire, relevé pendant la route, arrêt à la livraison", async ({ browser }, testInfo) => {
    const page = await driverPage(browser, crewMain, { geolocation: { latitude: 4.0511, longitude: 9.7679 } });
    const context = page.context();

    await expect(page.getByTestId("driver-gps-panel")).toBeVisible();
    await expect(page.getByTestId("driver-mission-map")).toBeVisible();
    const link = page.getByTestId("driver-gps-route-link");
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toContain("https://www.google.com/maps/dir/?");
    expect(new URL(href).searchParams.get("destination")).toBe("3.848,11.5021");
    // Avant le départ, rien n'est partagé.
    await expect(page.getByTestId("driver-gps-sharing")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("avant-depart-mobile.png") });

    const posts: { status: number; body: string }[] = [];
    page.on("response", async (response) => {
      if (response.request().method() === "POST" && response.url().includes(`/api/driver/missions/${crewMain.missionId}/positions`)) {
        posts.push({ status: response.status(), body: response.request().postData() ?? "" });
      }
    });

    await changeStatus(page, /CONFIRMER LE DÉPART/);
    await expect(page.getByTestId("driver-gps-sharing")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fleetos-gps-buffer-")).length)), { timeout: 30_000 }).toBeGreaterThan(0);

    await triggerFlush(page);
    await expect.poll(() => positionCount(crewMain.missionId), { timeout: 30_000 }).toBe(1);
    expect(posts[0].status).toBe(201);
    const sent = JSON.parse(posts[0].body) as { points: { clientPointId: string; recordedAt: string; lat: number }[] };
    expect(sent.points[0].clientPointId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(sent.points[0].recordedAt).toString()).not.toBe("Invalid Date");
    // Le tampon est vidé une fois le paquet accepté.
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fleetos-gps-buffer-")).length)).toBe(0);

    // Déplacement de 500 m : un second point, sans attendre 60 s.
    await context.setGeolocation({ latitude: 4.0556, longitude: 9.7679 });
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fleetos-gps-buffer-")).length), { timeout: 30_000 }).toBeGreaterThan(0);
    await triggerFlush(page);
    await expect.poll(() => positionCount(crewMain.missionId), { timeout: 30_000 }).toBe(2);
    await page.screenshot({ path: testInfo.outputPath(process.env.GPS_E2E_DESKTOP ? "en-route-bureau.png" : "en-route-mobile.png") });

    await changeStatus(page, /CONFIRMER LA LIVRAISON/);
    await expect(page.getByTestId("driver-gps-sharing")).toHaveCount(0, { timeout: 30_000 });
  });

  test("autorisation refusée : message clair, la mission avance", async ({ browser }, testInfo) => {
    const page = await driverPage(browser, crewDenied);
    await changeStatus(page, /CONFIRMER LE DÉPART/);
    await expect(page.getByTestId("driver-gps-denied")).toContainText("Position non partagée", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /CONFIRMER LA LIVRAISON/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("refus-mobile.png") });
    expect(await positionCount(crewDenied.missionId)).toBe(0);
  });

  test("drapeau gps coupé : ni carte, ni relevé, ni envoi", async ({ browser }) => {
    const page = await driverPage(browser, crewFlag, { geolocation: { latitude: 4.05, longitude: 9.77 }, flags: false });
    let posts = 0;
    page.on("request", (request) => {
      if (request.url().includes("/positions")) posts += 1;
    });
    await changeStatus(page, /CONFIRMER LE DÉPART/);
    await expect(page.getByRole("button", { name: /CONFIRMER LA LIVRAISON/ })).toBeVisible({ timeout: 30_000 });
    await triggerFlush(page);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("driver-gps-panel")).toHaveCount(0);
    expect(posts).toBe(0);
    expect(await positionCount(crewFlag.missionId)).toBe(0);
  });

  test("tampon orphelin d'une mission livrée : rejoué au retour sur l'écran, puis clé retirée", async ({ browser }) => {
    const before = await positionCount(crewMain.missionId);
    const key = `fleetos-gps-buffer-u${crewMain.user.id}-m${crewMain.missionId}`;
    const point = {
      clientPointId: crypto.randomUUID(),
      recordedAt: new Date(Date.now() - 60_000).toISOString(),
      lat: 3.9,
      lng: 10.2,
    };
    const context = await newE2EContext(browser, "chauffeur", { viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await loginWithSession(page, crewMain.user);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, JSON.stringify([point])] as const);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => positionCount(crewMain.missionId), { timeout: 30_000 }).toBe(before + 1);
    await expect.poll(() => page.evaluate((k) => window.localStorage.getItem(k), key), { timeout: 10_000 }).toBeNull();
  });

  test("un compte non chauffeur nedépose pas de position (403)", async ({ browser }) => {
    const context = await newE2EContext(browser, "logistique");
    const page = await context.newPage();
    await loginWithSession(page, logistics);
    const response = await page.request.post(`/api/driver/missions/${crewMain.missionId}/positions`, {
      data: { points: [{ clientPointId: "00000000-0000-4000-8000-000000000001", recordedAt: new Date().toISOString(), lat: 4, lng: 9 }] },
    });
    expect(response.status()).toBe(403);
  });
});
