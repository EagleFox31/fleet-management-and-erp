import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { FUEL_VOUCHER_STALE_MESSAGE } from "../shared/contracts/fuel-vouchers";
import { fuelRecords } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestFuelRecord, createTestVehicle } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { newE2EContext } from "./helpers/contexts";
import { createE2EUser } from "./helpers/test-data";

/**
 * Lot V3 : bons de carburant (P-17) activés par défaut après recette (drapeau sans surcharge FEATURE_FLAGS).
 * La logistique valide un bon en attente depuis l'écran ; le chef d'atelier, ouvert sur le même écran,
 * reçoit la trame `fuel_record_validated` et n'a pas de bouton « Valider ». Un plein validé est figé :
 * le rejeu répond 409 lisible, sans réécrire. Le technicien n'a ni écran ni validation (403).
 */

const ids = createIdBag();
type E2EUser = E2ECredentials & { id: number };
let logistics: E2EUser;
let workshopManager: E2EUser;
let technician: E2EUser;

test.beforeAll(async () => {
  logistics = await createE2EUser("logistics", ids);
  workshopManager = await createE2EUser("workshop_manager", ids);
  technician = await createE2EUser("technician", ids);
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

test("logistique valide un bon ; le chef d'atelier reçoit la trame et ne peut pas valider ; rejeu 409", async ({ page, browser }) => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  // Plein physique (aucun débit de carte), en attente de validation.
  const record = await createTestFuelRecord({ vehicleId: vehicle.id, debitAmount: "0", creditAmount: "0", cost: "50000.00" });
  ids.fuelRecordIds.push(record.id);

  const context = await newE2EContext(browser, "manager");
  const managerPage = await context.newPage();
  try {
    // Trames /ws capturées avant toute navigation : le socket s'ouvre au montage de l'app.
    const frames: string[] = [];
    managerPage.on("websocket", (ws) => {
      if (!ws.url().includes("/ws")) return;
      ws.on("framereceived", (frame) => frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString()));
    });
    await loginWithSession(managerPage, workshopManager);
    await managerPage.goto("/fuel/vouchers", { waitUntil: "domcontentloaded" });
    await expect(managerPage.getByTestId("fuel-vouchers")).toBeVisible({ timeout: 20_000 });
    await expect(managerPage.getByTestId(`fuel-voucher-validate-${record.id}`)).toHaveCount(0);

    await loginWithSession(page, logistics);
    await page.goto("/fuel/vouchers", { waitUntil: "domcontentloaded" });
    const button = page.getByTestId(`fuel-voucher-validate-${record.id}`);
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    // Filtre « En attente » : le bon validé quitte la liste.
    await expect(button).toHaveCount(0, { timeout: 15_000 });

    const stored = async () =>
      (await db.select({ s: fuelRecords.validationStatus, by: fuelRecords.validatedBy }).from(fuelRecords).where(eq(fuelRecords.id, record.id)))[0];
    await expect.poll(stored, { timeout: 15_000 }).toEqual({ s: "validated", by: logistics.id });

    await expect
      .poll(() => frames.some((f) => f.includes("fuel_record_validated") && f.includes(`"id":${record.id}`)), { timeout: 5_000 })
      .toBe(true);

    const replay = await page.request.post(`/api/fuel-vouchers/${record.id}/validate`, { data: {} });
    expect(replay.status()).toBe(409);
    expect((await replay.json()).message).toBe(FUEL_VOUCHER_STALE_MESSAGE);
    const denied = await managerPage.request.post(`/api/fuel-vouchers/${record.id}/validate`, { data: {} });
    expect(denied.status()).toBe(403);
  } finally {
    await context.close();
  }
});

test("technicien : pas de validation de bon (403)", async ({ page }) => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const record = await createTestFuelRecord({ vehicleId: vehicle.id, debitAmount: "0", creditAmount: "0", cost: "1000.00" });
  ids.fuelRecordIds.push(record.id);
  await loginWithSession(page, technician);
  const res = await page.request.post(`/api/fuel-vouchers/${record.id}/validate`, { data: {} });
  expect(res.status()).toBe(403);
  const [row] = await db.select({ s: fuelRecords.validationStatus }).from(fuelRecords).where(eq(fuelRecords.id, record.id));
  expect(row.s).toBe("pending");
});
