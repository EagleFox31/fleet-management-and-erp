import { expect, test, type Browser, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../server/db";
import { assignments, clients, drivers, missions, users, vehiclePositions, vehicles } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../tests/support/factories";
import { apiLogin, loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createLaunchableDriver, createLaunchableVehicle, creditFuelCard, LAUNCH_BUDGETS } from "./helpers/mission-journey";
import { newE2EContext } from "./helpers/contexts";
import { LOGISTICS_HUBS } from "../shared/constants/cemac-corridors";

/**
 * GPS V1 telephone, deux comptes de roles differents (AGENTS.md section 3). Serveur lance avec `FEATURE_FLAGS=gps=on`
 * sur une base locale. La logistique ne relit ni /api/vehicle-positions ni /track par polling (staleTime 60 s,
 * aucun refetchInterval) : l affichage recu dans les secondes qui suivent ne peut venir que de la trame WebSocket,
 * assertee elle-meme (`vehicle_position_updated`, `mission_updated { geo: true }`).
 * Donnees prefixees E2E-GPS2C-, supprimees en fin de spec.
 */
const PREFIX = "E2E-GPS2C-";
const ids = createIdBag();
let stamp = 0;
const token = (label: string) => `${PREFIX}${label}-${Date.now().toString(36)}-${++stamp}`;

type Crew = { user: E2ECredentials & { id: number }; missionId: number; orderNumber: string };
let crewMain: Crew;
let crewDenied: Crew;
let logistics: E2ECredentials & { id: number };
let logistics2: E2ECredentials & { id: number };

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


const LIVE_BUDGET_MS = 5_000; // nettement sous tout refetchInterval (7 s sur les listes) et sous le staleTime de 60 s

function watchFrames(page: Page): { frames: { at: number; text: string }[] } {
  const store = { frames: [] as { at: number; text: string }[] };
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/ws")) return;
    ws.on("framereceived", (f) => store.frames.push({ at: Date.now(), text: typeof f.payload === "string" ? f.payload : f.payload.toString() }));
  });
  return store;
}

async function openGpsTab(page: Page, missionId: number): Promise<void> {
  await page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /Suivi GPS/ }).click();
  await expect(page.getByTestId("mission-gps-panel")).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async () => {
  await purge();
  const client = await createTestClient({ name: token("CLIENT") });
  ids.clientIds.push(client.id);
  logistics = await createAccount("logistics", "LOGI");
  logistics2 = await createAccount("logistics", "LOGI2");
  await creditFuelCard(ids);
  crewMain = await createCrew("A", client.id);
  crewDenied = await createCrew("B", client.id);
});

test.afterAll(async () => {
  await purge();
  await cleanupCreated(ids);
});

test.describe.serial("GPS V1 téléphone : logistique et chauffeur", () => {
  test("position reçue par trame, points A/B vus par un second logisticien, cloison, arrêt à la livraison", async ({ browser }) => {
    test.setTimeout(180_000);
    const logiCtx = await newE2EContext(browser, "logistique-a");
    const logi2Ctx = await newE2EContext(browser, "logistique-b");
    const logiPage = await logiCtx.newPage();
    const logi2Page = await logi2Ctx.newPage();
    const logiFrames = watchFrames(logiPage);
    const logi2Frames = watchFrames(logi2Page);
    await loginWithSession(logiPage, logistics);
    await loginWithSession(logi2Page, logistics2);
    expect(logistics.id).not.toBe(crewMain.user.id);

    const page = await driverPage(browser, crewMain, { geolocation: { latitude: 4.0511, longitude: 9.7679 } });
    const posts: { at: number; status: number }[] = [];
    page.on("response", (r) => {
      if (r.request().method() === "POST" && r.url().includes(`/api/driver/missions/${crewMain.missionId}/positions`)) posts.push({ at: Date.now(), status: r.status() });
    });

    // Le chauffeur confirme le départ ; la logistique ouvre la fiche : aucune position encore.
    await changeStatus(page, /CONFIRMER LE DÉPART/);
    await expect(page.getByTestId("driver-gps-sharing")).toBeVisible({ timeout: 30_000 });
    await openGpsTab(logiPage, crewMain.missionId);
    await openGpsTab(logi2Page, crewMain.missionId);
    await expect(logiPage.getByTestId("gps-no-position")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fleetos-gps-buffer-")).length), { timeout: 30_000 })
      .toBeGreaterThan(0);
    const framesBefore = logiFrames.frames.length;
    const findPositionFrame = () => logiFrames.frames.slice(framesBefore).find((f) => f.text.includes("vehicle_position_updated"));

    // Envoi du paquet : trame, puis affichage, sans refetch d'intervalle.
    const sentAt = Date.now();
    await triggerFlush(page);
    await expect.poll(findPositionFrame, { timeout: LIVE_BUDGET_MS, intervals: [50] }).toBeTruthy();
    const frame = findPositionFrame()!;
    const frameDelay = frame.at - sentAt;
    expect(frame.text).toContain(`"missionId":${crewMain.missionId}`);
    await expect(logiPage.getByTestId("gps-position-where")).toBeVisible({ timeout: LIVE_BUDGET_MS });
    const shownDelay = Date.now() - sentAt;
    console.log(`GPS_DELAY trame=${frameDelay}ms affichage=${shownDelay}ms`);
    expect(shownDelay).toBeLessThan(LIVE_BUDGET_MS);
    expect(await positionCount(crewMain.missionId)).toBe(1);

    // Points A/B par la logistique A ; la logistique B reçoit mission_updated { geo: true } puis relit /track.
    const hubs = Object.keys(LOGISTICS_HUBS);
    const [hubA, hubB] = [hubs[0], hubs[hubs.length - 1]];
    const pickHub = async (which: "pickup" | "delivery", code: string) => {
      await logiPage.getByTestId(`geo-hub-${which}`).click();
      await logiPage.getByRole("option", { name: LOGISTICS_HUBS[code].name, exact: true }).click();
    };
    const geoBefore = logi2Frames.frames.length;
    const trackReads: number[] = [];
    logi2Page.on("response", (r) => {
      if (r.request().method() === "GET" && r.url().includes(`/api/missions/${crewMain.missionId}/track`)) trackReads.push(Date.now());
    });
    await pickHub("pickup", hubA);
    await pickHub("delivery", hubB);
    const saved = logiPage.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/api/missions/${crewMain.missionId}/geo`));
    const saveAt = Date.now();
    await logiPage.getByTestId("geo-save").click();
    expect((await saved).ok()).toBeTruthy();
    await expect
      .poll(() => logi2Frames.frames.slice(geoBefore).some((f) => f.text.includes("mission_updated") && f.text.includes('"geo":true')), { timeout: LIVE_BUDGET_MS, intervals: [50] })
      .toBeTruthy();
    await expect.poll(() => trackReads.some((t) => t >= saveAt), { timeout: LIVE_BUDGET_MS, intervals: [50] }).toBeTruthy();
    await expect(logi2Page.getByTestId("geo-summary-pickup")).toContainText(LOGISTICS_HUBS[hubA].name, { timeout: LIVE_BUDGET_MS });
    await expect(logi2Page.getByTestId("geo-summary-delivery")).toContainText(LOGISTICS_HUBS[hubB].name, { timeout: LIVE_BUDGET_MS });
    console.log(`GPS_DELAY geo trame+refetch+affichage=${Date.now() - saveAt}ms`);

    // Cloison : un chauffeur non affecté ne dépose rien et ne lit rien sur cette mission.
    const otherCtx = await newE2EContext(browser, "chauffeur-non-affecte");
    const otherPage = await otherCtx.newPage();
    await loginWithSession(otherPage, crewDenied.user);
    const point = { clientPointId: crypto.randomUUID(), recordedAt: new Date().toISOString(), lat: 4.0, lng: 9.7 };
    const before = await positionCount(crewMain.missionId);
    const denied = await otherPage.request.post(`/api/driver/missions/${crewMain.missionId}/positions`, { data: { points: [point] } });
    expect(denied.status()).toBe(403);
    expect((await otherPage.request.get(`/api/missions/${crewMain.missionId}/track`)).status()).toBe(403);
    expect(await positionCount(crewMain.missionId)).toBe(before);

    // Livraison : le suivi s'arrête, plus aucun POST de positions.
    await changeStatus(page, /CONFIRMER LA LIVRAISON/);
    await expect(page.getByTestId("driver-gps-sharing")).toHaveCount(0, { timeout: 30_000 });
    const postsAtDelivery = posts.length;
    const rowsAtDelivery = await positionCount(crewMain.missionId);
    await page.context().setGeolocation({ latitude: 4.2, longitude: 9.9 });
    await triggerFlush(page);
    await page.waitForTimeout(4_000);
    await triggerFlush(page);
    await page.waitForTimeout(2_000);
    expect(posts.length).toBe(postsAtDelivery);
    expect(await positionCount(crewMain.missionId)).toBe(rowsAtDelivery);
  });
});
