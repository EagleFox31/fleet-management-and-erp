import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { fuelAnomalyResolutions, tires, vehicles, vehicleTires } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestFuelRecord, createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";
import { createE2EUser } from "./helpers/test-data";

/**
 * Lot V3, point 1 : écrans activés par défaut après recette (drapeaux sans surcharge FEATURE_FLAGS).
 * - Mouvements de pneus : le magasinier retrouve le montage du jour (pneu, immatriculation).
 * - Anomalies carburant : un plein au-delà de la capacité du réservoir (règle tank-overflow) apparaît ;
 *   la logistique le traite, le chef d'atelier le consulte sans bouton « Traiter ».
 * Les données sont datées du jour (UTC) ; chaque assertion cible la ligne par son identifiant, sans dépendre de l'ordre de tri.
 */

const ids = createIdBag();
const tireIds: number[] = [];
const anomalyKeys: string[] = [];
type E2EUser = E2ECredentials & { id: number };
let warehouse: E2EUser;
let logistics: E2EUser;
let workshopManager: E2EUser;
const today = new Date().toISOString().slice(0, 10);

test.beforeAll(async () => {
  warehouse = await createE2EUser("warehouse", ids);
  logistics = await createE2EUser("logistics", ids);
  workshopManager = await createE2EUser("workshop_manager", ids);
});

test.afterAll(async () => {
  if (anomalyKeys.length) await db.delete(fuelAnomalyResolutions).where(inArray(fuelAnomalyResolutions.anomalyKey, anomalyKeys));
  if (tireIds.length) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  await cleanupCreated(ids);
});

test("magasinier : le montage du jour figure dans les mouvements de pneus", async ({ page }) => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const model = uniqueTestToken("mv");
  const [tire] = await db
    .insert(tires)
    .values({ brand: "E2E", model, size: "315/80R22.5", createdBy: warehouse.id })
    .returning({ id: tires.id });
  tireIds.push(tire.id);
  await db.insert(vehicleTires).values({
    vehicleId: vehicle.id, tireId: tire.id, position: "front_left", installationDate: today, installationMileage: 1000,
  });

  await loginWithSession(page, warehouse);
  await page.goto("/inventory/tires/movements", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tire-movements")).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole("row").filter({ hasText: model });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(vehicle.registrationNumber);
});

test("logistique traite une anomalie de plein ; le chef d'atelier la consulte sans la traiter", async ({ page, browser }) => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  // La fabrique ne renseigne pas la capacité du réservoir : sans elle, tank-overflow reste muette.
  await db.update(vehicles).set({ tankCapacityL: 50 }).where(eq(vehicles.id, vehicle.id));
  const [year, month] = today.split("-").map(Number);
  const record = await createTestFuelRecord({ vehicleId: vehicle.id, date: today, year, month, quantity: 80 });
  ids.fuelRecordIds.push(record.id);
  const key = `tank-overflow:${record.id}`;
  anomalyKeys.push(key);

  await loginWithSession(page, logistics);
  await page.goto("/fuel/anomalies", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`fuel-anomaly-rule-${key}`)).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole("row").filter({ has: page.getByTestId(`fuel-anomaly-rule-${key}`) });
  await expect(row).toContainText("Ouverte");

  await page.getByTestId(`fuel-anomaly-resolve-${key}`).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Commentaire").fill("Plein de réserve");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(row).toContainText("Justifiée", { timeout: 15_000 });

  const stored = async () =>
    (await db.select({ status: fuelAnomalyResolutions.status, comment: fuelAnomalyResolutions.comment })
      .from(fuelAnomalyResolutions).where(eq(fuelAnomalyResolutions.anomalyKey, key)))[0];
  await expect.poll(stored, { timeout: 15_000 }).toEqual({ status: "justified", comment: "Plein de réserve" });

  const context = await newE2EContext(browser, "manager");
  const other = await context.newPage();
  try {
    await loginWithSession(other, workshopManager);
    await other.goto("/fuel/anomalies", { waitUntil: "domcontentloaded" });
    const readOnlyRow = other.getByRole("row").filter({ has: other.getByTestId(`fuel-anomaly-rule-${key}`) });
    await expect(readOnlyRow).toContainText("Justifiée", { timeout: 20_000 });
    await expect(other.getByTestId(`fuel-anomaly-resolve-${key}`)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
