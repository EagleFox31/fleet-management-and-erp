import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { assignments, drivers, missions, vehicleDocuments } from "../../shared/schema";
import type { CreatedIds } from "../../tests/support/cleanup";
import { createTestFuelRecord, createTestVehicle } from "../../tests/support/factories";

/**
 * Parcours d'une mission jusqu'à « livrée » sans écrire son statut en base : affectation,
 * budgets, lancement (gardes métier réelles : papiers, CPC, solde carte), livraison.
 *
 * Partagé par `13-mission-invoice-payment` et `17-mission-lifecycle`. La spec 17 garde sa
 * version au navigateur entrecoupée des contrôles de l'observateur.
 */

export const FAR = "2099-12-31";

/** Budgets saisis au lancement : la carte doit couvrir le budget carburant. */
export const LAUNCH_BUDGETS = { fuelBudget: 1000, roadExpensesBudget: 5000, contingencyBudget: 2000 } as const;

/** Véhicule aux trois papiers valides ; ses documents partent en cascade avec lui. */
export async function createLaunchableVehicle(
  ids: CreatedIds,
  registrationNumber: string,
  overrides: { insuranceDoc?: string } = {},
) {
  const vehicle = await createTestVehicle({ registrationNumber });
  ids.vehicleIds.push(vehicle.id);
  const doc = (type: "carte_grise" | "assurance" | "visite_technique", expiryDate: string) => ({
    vehicleId: vehicle.id,
    name: `${registrationNumber} ${type}`,
    type,
    filename: `${type}.pdf`,
    filesize: 1,
    fileType: "application/pdf",
    filePath: `uploads/${registrationNumber}-${type}.pdf`,
    expiryDate,
  });
  await db.insert(vehicleDocuments).values([
    doc("carte_grise", FAR),
    doc("assurance", overrides.insuranceDoc ?? FAR),
    doc("visite_technique", FAR),
  ]);
  return vehicle;
}

/** Chauffeur actif, permis valable ; `driverIds` reçoit son id pour le nettoyage. */
export async function createLaunchableDriver(
  driverIds: number[],
  lastName: string,
  employeeNumber: string,
  cpcStatus = "FORMÉ",
) {
  const [driver] = await db
    .insert(drivers)
    .values({ firstName: "Chauffeur", lastName, employeeNumber, cpcStatus, licenseExpiry: FAR, isActive: true })
    .returning();
  driverIds.push(driver.id);
  return driver;
}

/** Le lancement exige un solde de carte au moins égal au budget carburant. */
export async function creditFuelCard(ids: CreatedIds, amount = "5000000") {
  const credit = await createTestFuelRecord({
    creditAmount: amount,
    debitAmount: "0",
    quantity: 1,
    cost: "0",
    stationName: "APPROVISIONNEMENT",
  });
  ids.fuelRecordIds.push(credit.id);
}

/** Supprime affectations, missions et chauffeurs créés (les factures sont à la charge de l'appelant). */
export async function deleteJourneyRows(missionIds: number[], driverIds: number[]) {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
}

export async function missionStatus(id: number) {
  const [row] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, id));
  return row?.status;
}

type Crew = { vehicleId: number; driverId: number };

/** Même parcours, par l'API avec la session donnée (logistique) : mêmes routes que l'écran. */
export async function driveToDeliveredByApi(api: APIRequestContext, missionId: number, crew: Crew) {
  const step = async (label: string, res: Awaited<ReturnType<APIRequestContext["put"]>>) =>
    expect(res.status(), `${label} : ${await res.text()}`).toBeLessThan(300);
  await step("affectation", await api.patch(`/api/missions/${missionId}`, { data: { assignment: crew } }));
  expect(await missionStatus(missionId)).toBe("assigned");
  await step("budgets", await api.patch(`/api/missions/${missionId}`, { data: { budget: LAUNCH_BUDGETS } }));
  await step("lancement", await api.put(`/api/missions/${missionId}/status`, { data: { status: "in_progress" } }));
  await step("livraison", await api.put(`/api/missions/${missionId}/status`, { data: { status: "delivered" } }));
  expect(await missionStatus(missionId)).toBe("delivered");
}

/** Le parcours à l'écran (mêmes testid que la spec 17) : affectation, lancement, livraison. */
export async function driveToDeliveredInBrowser(page: Page, missionId: number, orderNumber: string, crew: Crew) {
  await page.goto(`/missions/${missionId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: orderNumber })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  const vehicleSelect = page.getByTestId("select-edit-vehicle");
  await expect(vehicleSelect.locator(`option[value="${crew.vehicleId}"]`)).toHaveCount(1, { timeout: 30_000 });
  await vehicleSelect.selectOption(String(crew.vehicleId));
  const driverSelect = page.getByTestId("select-edit-driver");
  await expect(driverSelect.locator(`option[value="${crew.driverId}"]`)).toHaveCount(1, { timeout: 30_000 });
  await driverSelect.selectOption(String(crew.driverId));
  await page.getByTestId("button-save-mission").click();
  await expect.poll(() => missionStatus(missionId), { timeout: 20_000 }).toBe("assigned");

  await page.getByTestId("button-transition-mission-status-header").click();
  await expect(page.getByTestId("button-save-mission-budgets")).toBeVisible();
  for (const [field, value] of Object.entries(LAUNCH_BUDGETS)) {
    const input = page.getByTestId(`input-mission-budget-${field}`);
    if (await input.isVisible()) await input.fill(String(value));
  }
  await page.getByTestId("button-save-mission-budgets").click();
  await expect.poll(() => missionStatus(missionId), { timeout: 30_000 }).toBe("in_progress");

  await page.getByTestId("button-transition-mission-status-header").click();
  await expect.poll(() => missionStatus(missionId), { timeout: 30_000 }).toBe("delivered");
}
