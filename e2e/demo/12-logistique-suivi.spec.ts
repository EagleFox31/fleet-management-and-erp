import { expect, test, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { missions, vehiclePositions } from "../../shared/schema";
import { beat, loginThroughForm, mark } from "./helpers";
import { assertLocalDatabase, DEMO_ACCOUNTS, seedDemo } from "./seed-demo";
import { DEMO_GPS_TRIPS, seedDemoGps } from "./seed-demo-gps";

/**
 * Démo « logistique, suivi GPS » : le logisticien suit ses camions en mission à la trace.
 * Carte de la flotte (dernière position de chaque camion et son heure), puis la mission et sa trace.
 *
 * Serveur lancé avec FEATURE_FLAGS=gps=on, sinon la carte et l'onglet « Suivi GPS » n'existent pas.
 * Le seed GPS recale les horaires sur l'heure courante : à rejouer juste avant le tournage.
 * `mark(...)` pose des repères de montage (voix off) quand DEMO_MARKS_FILE est défini.
 */
const [FIRST, SECOND] = DEMO_GPS_TRIPS;

async function positionsOf(orderNumber: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vehiclePositions)
    .innerJoin(missions, eq(missions.id, vehiclePositions.missionId))
    .where(eq(missions.orderNumber, orderNumber));
  return row?.n ?? 0;
}

/** Fond de carte affiché (tuiles chargées) : sinon la vidéo montre un cadre gris. */
async function waitForTiles(page: Page, testId: string): Promise<void> {
  await expect(page.getByTestId(testId).locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 30_000 });
  await beat(page, 1200);
}

async function openFleetMap(page: Page): Promise<void> {
  const link = page.getByRole("link", { name: "Carte de la flotte" }).first();
  if (await link.isVisible().catch(() => false)) await link.click();
  else await page.goto("/fleet/map");
  await expect(page.getByTestId("fleet-positions-map")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("fleet-positions-table")).toContainText(FIRST.orderNumber, { timeout: 30_000 });
  await waitForTiles(page, "fleet-positions-map");
}

async function openMissionTrack(page: Page, orderNumber: string): Promise<void> {
  await page.getByTestId("fleet-positions-table").getByRole("link", { name: orderNumber }).click();
  await expect(page.getByRole("tab", { name: /Suivi GPS/ })).toBeVisible({ timeout: 30_000 });
  await beat(page, 1500);
  await page.getByRole("tab", { name: /Suivi GPS/ }).click();
  await expect(page.getByTestId("mission-track-map")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gps-position-age")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gps-position-where")).not.toBeEmpty();
  await waitForTiles(page, "mission-track-map");
}

test.beforeAll(async () => {
  assertLocalDatabase();
  await seedDemo();
  await seedDemoGps();
});

test("démo logistique : suivre ses camions en mission à la trace", async ({ page }) => {
  test.setTimeout(300_000);
  expect(await positionsOf(FIRST.orderNumber)).toBeGreaterThan(50);
  expect(await positionsOf(SECOND.orderNumber)).toBeGreaterThan(30);

  mark("start");
  await loginThroughForm(page, DEMO_ACCOUNTS.logistics.username, DEMO_ACCOUNTS.logistics.password);
  mark("login-done");
  await beat(page, 9_000);
  mark("dashboard-done");

  // 1. Carte de la flotte : chaque camion en route, sa dernière position et depuis quand.
  await openFleetMap(page);
  mark("map-open");
  await expect(page.getByTestId("fleet-positions-table")).toContainText(SECOND.orderNumber);
  await beat(page, 18_000);
  mark("map-read");

  // 2. Un clic sur la ligne met le camion en évidence sur la carte.
  await page.getByTestId("fleet-positions-table").getByText(FIRST.vehicle).first().click();
  await beat(page, 9_000);
  mark("truck-selected");

  // 3. La mission et sa trace : le chemin parcouru depuis Douala, la dernière position et son heure.
  await openMissionTrack(page, FIRST.orderNumber);
  mark("track-open");
  await page.getByTestId("mission-track-map").scrollIntoViewIfNeeded();
  await beat(page, 26_000);
  mark("track-read");

  // 4. Retour à la carte, second camion sur la route de Bafoussam.
  // Retour arrière dans l'application : un `goto` rechargerait tout et filmerait l'écran de chargement.
  for (let i = 0; i < 3 && !page.url().endsWith("/fleet/map"); i++) {
    await page.goBack();
    await page.waitForURL(/\/fleet\/map$/, { timeout: 2_000 }).catch(() => undefined);
  }
  await openFleetMap(page);
  await beat(page, 3_000);
  mark("map-back");
  await openMissionTrack(page, SECOND.orderNumber);
  mark("track2-open");
  await page.getByTestId("mission-track-map").scrollIntoViewIfNeeded();
  await beat(page, 18_000);
  mark("track2-read");
  await beat(page, 3_000);
  mark("end");
});
