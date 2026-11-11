import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { assignments, incidents, missions, vehiclePositions, vehicles } from "../../shared/schema";
import { beat, loginThroughForm, mark } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, DEMO_DRIVER_DAY, DEMO_MISSION, seedDemo } from "./seed-demo";

/**
 * Démo « chauffeur », trois profils dans l'ordre du récit :
 *   1. le logisticien programme la mission (camion, remorque, chauffeur) ;
 *   2. le chauffeur se connecte avec son PIN, voit sa mission du jour et confirme le départ ;
 *   3. en route, il déclare une panne ; le chef d'atelier, déjà connecté, reçoit l'alerte et la voit dans « Pannes déclarées ».
 *
 * Trois contextes séparés (trois rôles). Le chef d'atelier est ouvert avant la panne : la preuve de l'alerte en
 * direct est la trame WebSocket `incident_reported` qu'il reçoit, pas un écran rafraîchi par un intervalle.
 * `mark(...)` pose des repères de montage quand DEMO_MARKS_FILE est défini.
 */
const ORDER = DEMO_DRIVER_DAY.orderNumber;

/**
 * Trajet simulé du camion, de Douala vers Bafoussam, par sauts de 2 à 4 km : chaque saut dépasse les 200 m
 * qui déclenchent un relevé (`GPS_SAMPLE_DISTANCE_M`), donc chaque étape ajoute un point à la trace.
 */
const ROUTE = [
  { latitude: 4.0511, longitude: 9.6870 },
  { latitude: 4.0620, longitude: 9.7050 },
  { latitude: 4.0790, longitude: 9.7260 },
  { latitude: 4.0990, longitude: 9.7440 },
  { latitude: 4.1230, longitude: 9.7580 },
  { latitude: 4.1500, longitude: 9.7700 },
  { latitude: 4.1780, longitude: 9.7850 },
  { latitude: 4.2050, longitude: 9.8030 },
] as const;
const ROUTE_AFTER_REPAIR = [
  { latitude: 4.2350, longitude: 9.8200 },
  { latitude: 4.2700, longitude: 9.8350 },
  { latitude: 4.3050, longitude: 9.8550 },
] as const;

/** Fait avancer le camion point par point, à l'écran : position et trace se mettent à jour. */
async function drive(context: BrowserContext, page: Page, points: readonly { latitude: number; longitude: number }[]): Promise<void> {
  for (const point of points) {
    await context.setGeolocation({ ...point });
    await beat(page, 1600);
  }
}

/** Le tampon GPS est envoyé au retour du réseau : on déclenche l'envoi sans attendre les 2 min de cadence. */
const flushGps = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const positionCount = async (missionId: number) =>
  (await db.select({ id: vehiclePositions.id }).from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId))).length;
const VIEWPORT = { width: 1920, height: 1080 } as const;

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
});

const missionRow = async () => (await db.select({ id: missions.id, status: missions.status }).from(missions).where(eq(missions.orderNumber, ORDER)))[0];

/** Contexte filmé en 1920x1080 quand E2E_RECORD=1 (une vidéo par profil, dans le dossier du test). */
async function profileContext(browser: Browser, label: string, extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const record = process.env.E2E_RECORD === "1";
  const context = await browser.newContext({
    ...extra,
    viewport: { ...VIEWPORT },
    ...(record ? { recordVideo: { dir: test.info().outputPath(`video-${label}`), size: { ...VIEWPORT } } } : {}),
  });
  mark(`ctx-${label}`);
  return context;
}

/** Retient les trames du socket temps réel dès son ouverture. */
function captureFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/ws")) return;
    socket.on("framereceived", (frame) => frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString()));
  });
  return frames;
}

test("démo chauffeur : mission programmée, départ confirmé, panne reçue par l'atelier", async ({ browser }) => {
  test.setTimeout(420_000);
  expect(await missionRow()).toBeUndefined();

  const logisticsContext = await profileContext(browser, "logisticien");
  // Le téléphone du chauffeur partage sa position (serveur lancé avec FEATURE_FLAGS=gps=on).
  const driverContext = await profileContext(browser, "chauffeur", { geolocation: { ...ROUTE[0] }, permissions: ["geolocation"] });
  const workshopContext = await profileContext(browser, "chef-atelier");
  try {
    // Le chef d'atelier est connecté d'avance, sur son tableau de bord : il attend les alertes.
    const workshop = await workshopContext.newPage();
    mark("page-chef-atelier"); // la vidéo de ce profil commence ici
    const workshopFrames = captureFrames(workshop);
    await loginThroughForm(workshop, DEMO_ACCOUNTS.workshopManager.username, DEMO_ACCOUNTS.workshopManager.password);
    await expect.poll(() => workshopFrames.some((f) => f.includes("auth_success")), { timeout: 30_000 }).toBe(true);
    mark("workshop-ready");

    // 1. Le logisticien programme la mission.
    const logistics = await logisticsContext.newPage();
    mark("page-logisticien"); // la vidéo de ce profil commence ici
    mark("start");
    await loginThroughForm(logistics, DEMO_ACCOUNTS.logistics.username, DEMO_ACCOUNTS.logistics.password);
    mark("logistics-login-done");
    await logistics.getByRole("link", { name: "Missions transport" }).first().click();
    await expect(logistics.getByTestId("btn-new-mission")).toBeVisible({ timeout: 30_000 });
    await beat(logistics, 1200);
    await logistics.getByTestId("btn-new-mission").click();
    await beat(logistics, 1200);
    mark("wizard-open");

    await logistics.getByTestId("select-client").click();
    await logistics.getByRole("option", { name: DEMO_MISSION.clientName }).click();
    await logistics.getByTestId("input-order-number").fill(ORDER);
    await beat(logistics);
    await logistics.getByTestId("btn-next").click();

    await logistics.getByTestId("input-pickup-address").fill(DEMO_DRIVER_DAY.pickup);
    await logistics.getByTestId("input-delivery-address").fill(DEMO_DRIVER_DAY.delivery);
    await logistics.getByTestId("textarea-cargo").fill("Sacs de ciment, 20 tonnes");
    await beat(logistics);
    mark("route-done");
    await logistics.getByTestId("btn-next").click();

    await logistics.getByTestId("select-vehicle").click();
    await logistics.getByRole("option", { name: new RegExp(DEMO_DRIVER_DAY.vehicle) }).click();
    await beat(logistics, 1200);
    mark("truck-done");
    await logistics.getByTestId("select-trailer").click();
    await logistics.getByRole("option", { name: new RegExp(DEMO_MISSION.trailer) }).click();
    await expect(logistics.getByTestId("select-trailer")).toContainText(DEMO_MISSION.trailer);
    await beat(logistics, 1800);
    mark("trailer-done");
    await logistics.getByTestId("select-driver").click();
    await logistics.getByRole("option", { name: new RegExp(DEMO_DRIVER_DAY.employee) }).click();
    await beat(logistics, 1200);
    mark("driver-done");
    await logistics.getByTestId("btn-next").click();
    await beat(logistics, 2500);
    mark("summary-done");
    await logistics.getByTestId("btn-submit").click();
    mark("submitted");
    await expect.poll(async () => (await missionRow())?.status, { timeout: 30_000 }).toBeTruthy();
    await expect(logistics.getByTestId("table-missions")).toBeVisible({ timeout: 30_000 });
    await beat(logistics, 1500);
    mark("created-shown");

    // Les budgets sont fixés avant le départ : sans eux, le chauffeur ne peut pas lancer la mission.
    await logistics.getByTestId("input-search-missions").fill(ORDER);
    await beat(logistics, 800);
    await logistics.getByText(ORDER, { exact: true }).first().click();
    await expect(logistics.getByRole("heading", { name: ORDER })).toBeVisible({ timeout: 30_000 });
    await beat(logistics, 1500);
    await logistics.getByTestId("button-open-mission-budgets").click();
    for (const [field, value] of [["fuelBudget", "150000"], ["roadExpensesBudget", "40000"], ["contingencyBudget", "20000"]] as const) {
      const input = logistics.getByTestId(`input-mission-budget-${field}`);
      await expect(input).toBeVisible({ timeout: 15_000 });
      await input.fill(value);
      await beat(logistics, 400);
    }
    mark("budgets-filled");
    await logistics.getByTestId("button-save-mission-budgets").click();
    await expect
      .poll(async () => JSON.stringify((await db.select({ w: missions.workflowData }).from(missions).where(eq(missions.orderNumber, ORDER)))[0]?.w ?? {}), { timeout: 30_000 })
      .toContain("150000");
    await beat(logistics, 2500);
    mark("logistics-done");

    // Assertion dure : la mission porte le bon camion, la bonne remorque et le bon chauffeur.
    const mission = (await missionRow())!;
    const [truck] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.registrationNumber, DEMO_DRIVER_DAY.vehicle));
    const [trailer] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.registrationNumber, DEMO_MISSION.trailer));
    const [assignment] = await db.select().from(assignments).where(eq(assignments.missionId, mission.id));
    expect(assignment.vehicleId).toBe(truck.id);
    expect(assignment.trailerId).toBe(trailer.id);
    expect(assignment.driverId).not.toBeNull();

    // 2. Le chauffeur se connecte avec son PIN, voit la mission du jour et confirme le départ.
    const driver = await driverContext.newPage();
    mark("page-chauffeur"); // la vidéo de ce profil commence ici
    await driver.goto("/login", { waitUntil: "domcontentloaded" });
    mark("driver-login-open");
    await beat(driver, 1500);
    await driver.getByRole("button", { name: /Connexion Chauffeur \(PIN\)/ }).click();
    await beat(driver, 800);
    await driver.getByRole("button", { name: new RegExp(DEMO_ACCOUNTS.driver.name) }).click();
    await beat(driver, 1000);
    mark("driver-picked");
    for (const digit of DEMO_DRIVER_DAY.pin) {
      await driver.getByRole("button", { name: digit, exact: true }).click();
      await beat(driver, 350);
    }
    await expect(driver.getByText(DEMO_DRIVER_DAY.delivery).first()).toBeVisible({ timeout: 30_000 });
    await beat(driver, 3000);
    mark("driver-mission");

    const start = driver.locator('[data-help-target="driver-status-action"]');
    await expect(start).toContainText("CONFIRMER LE DÉPART");
    await beat(driver, 1500);
    await start.click();
    await expect(driver.getByText("Départ confirmé !", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(start).toContainText("CONFIRMER LA LIVRAISON");
    await expect.poll(async () => (await missionRow())?.status, { timeout: 30_000 }).toBe("in_progress");
    await beat(driver, 2500);
    mark("departure-done");

    // 2 bis. En route : la position du téléphone est partagée, le camion avance sur la carte de la mission.
    const gpsPanel = driver.getByTestId("driver-gps-panel");
    await expect(driver.getByTestId("driver-gps-sharing")).toBeVisible({ timeout: 30_000 });
    await gpsPanel.scrollIntoViewIfNeeded();
    await beat(driver, 1500);
    mark("gps-sharing");
    await drive(driverContext, driver, ROUTE.slice(1));
    mark("gps-trace");
    await flushGps(driver);
    // Assertion dure : les positions du trajet sont enregistrées sur la mission, côté serveur.
    await expect.poll(() => positionCount(mission.id), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    await expect(driver.getByTestId("driver-gps-last-sent")).toBeVisible({ timeout: 30_000 });
    await beat(driver, 2500);
    mark("gps-sent");
    await driver.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await beat(driver, 1000);

    // 3. En route : la panne.
    await driver.getByRole("button", { name: "Signaler un problème" }).click();
    await expect(driver.getByRole("heading", { name: "Signaler un problème" })).toBeVisible();
    await beat(driver, 1500);
    await driver.getByRole("button", { name: "Panne véhicule" }).click();
    await beat(driver, 800);
    await driver.getByRole("button", { name: "Élevée", exact: true }).click();
    await beat(driver, 1500);
    mark("report-filled");
    const framesBefore = workshopFrames.length;
    await driver.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(driver.getByText("Problème signalé", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    mark("report-sent");
    await beat(driver, 2500);
    mark("driver-done-all");

    // Assertion dure : la panne existe, sur le camion de la mission, déclarée par le chauffeur.
    const [incident] = await db.select().from(incidents).where(eq(incidents.vehicleId, truck.id)).orderBy(desc(incidents.id)).limit(1);
    expect(incident, "panne enregistrée").toBeTruthy();
    expect(incident.vehicleId).toBe(truck.id);
    expect(incident.description).toContain(ORDER);

    // Le chef d'atelier reçoit la trame de la panne sans rien recharger (deux rôles, deux sessions).
    await expect
      .poll(() => workshopFrames.slice(framesBefore).some((f) => f.includes("incident_reported") && f.includes(`"entityId":${incident.id}`)), { timeout: 20_000 })
      .toBe(true);
    mark("workshop-frame");

    // 4. Le chef d'atelier ouvre l'alerte, puis voit la panne dans « Pannes déclarées ».
    await beat(workshop, 1500);
    await workshop.getByRole("button", { name: "Ouvrir les alertes" }).click();
    await expect(workshop.getByText("Panne grave déclarée").first()).toBeVisible({ timeout: 30_000 });
    await beat(workshop, 3500);
    mark("workshop-alert");
    await workshop.getByText("Panne grave déclarée").first().click();
    await expect(workshop.getByTestId("incident-list")).toBeVisible({ timeout: 30_000 });
    await expect(workshop.getByText(DEMO_DRIVER_DAY.vehicle).first()).toBeVisible({ timeout: 30_000 });
    await beat(workshop, 4000);
    mark("workshop-list");

    // 5. La panne réglée, le chauffeur repart, arrive et confirme la livraison.
    await driver.bringToFront();
    await gpsPanel.scrollIntoViewIfNeeded();
    await beat(driver, 1000);
    mark("driver-back");
    const positionsBefore = await positionCount(mission.id);
    await drive(driverContext, driver, ROUTE_AFTER_REPAIR);
    await flushGps(driver);
    await expect.poll(() => positionCount(mission.id), { timeout: 30_000 }).toBeGreaterThan(positionsBefore);
    mark("gps-arrived");
    await driver.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await beat(driver, 1200);
    await expect(start).toContainText("CONFIRMER LA LIVRAISON");
    await start.click();
    await expect.poll(async () => (await missionRow())?.status, { timeout: 30_000 }).toBe("delivered");
    await beat(driver, 3000);
    mark("delivered");
  } finally {
    await logisticsContext.close();
    await driverContext.close();
    await workshopContext.close();
  }
});
