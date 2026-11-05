import { expect, test, type APIResponse } from "@playwright/test";
import { like } from "drizzle-orm";
import { db } from "../server/db";
import { parts, tires, vehicles, workOrders } from "../shared/schema";
import { loginAs, loginWithSession } from "./helpers/auth";
import { recetteAccount, requireRecettePassword, vehiclesOwnedBy, type RecetteAccount } from "./helpers/recette-accounts";

/**
 * Profil direction (`management`), niveau E.
 *
 * La direction lit les tableaux de bord et les KPI. Elle ne crée ni véhicule, ni OT, ni fiche
 * pièce ou pneu, et ne saisit pas de carburant : chaque écriture est refusée en 403 au contrat
 * d'erreur (`code`, `requestId`), et rien n'est écrit en base.
 *
 * Données : compte recette_direction (scripts/recette-seed.ts). Les écritures tentées portent
 * le préfixe E2E-DIR-. Un refus n'écrit rien, mais la spec purge ce préfixe à l'ouverture et
 * en fin de run, au cas où une garde régresserait.
 */

const PREFIX = "E2E-DIR-";
let direction: RecetteAccount;
let anyVehicleId: number;

requireRecettePassword("management", "client");

async function purge(): Promise<void> {
  await db.delete(workOrders).where(like(workOrders.title, `${PREFIX}%`));
  await db.delete(parts).where(like(parts.reference, `${PREFIX}%`));
  await db.delete(tires).where(like(tires.brand, `${PREFIX}%`));
  await db.delete(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`));
}

async function prefixedRows(): Promise<number> {
  const counts = await Promise.all([
    db.select({ id: workOrders.id }).from(workOrders).where(like(workOrders.title, `${PREFIX}%`)),
    db.select({ id: parts.id }).from(parts).where(like(parts.reference, `${PREFIX}%`)),
    db.select({ id: tires.id }).from(tires).where(like(tires.brand, `${PREFIX}%`)),
    db.select({ id: vehicles.id }).from(vehicles).where(like(vehicles.registrationNumber, `${PREFIX}%`)),
  ]);
  return counts.reduce((sum, rows) => sum + rows.length, 0);
}

async function expectForbidden(response: APIResponse, what: string): Promise<void> {
  expect(response.status(), what).toBe(403);
  const body = await response.json();
  expect(body.code, what).toBe("FORBIDDEN");
  expect(body.requestId, what).toBe(response.headers()["x-request-id"]);
}

test.describe.configure({ mode: "serial" });

test.describe("Profil direction : lecture des tableaux de bord, écritures refusées", () => {
  test.beforeAll(async () => {
    await purge();
    direction = await recetteAccount(process.env.E2E_DIRECTION_USERNAME || "recette_direction", "management", "direction");
    // Un véhicule de la base de recette sert de cible aux écritures refusées.
    const client = await recetteAccount(process.env.E2E_CLIENT_A_USERNAME || "recette_client_1", "client", "client A");
    const [vehicle] = await vehiclesOwnedBy(client.id);
    expect(vehicle, "un véhicule de recette doit exister (seed de recette)").toBeTruthy();
    anyVehicleId = vehicle.id;
  });

  test.afterAll(async () => {
    await purge();
  });

  test("connexion : tableau de bord direction et tuiles KPI rendus", async ({ page }) => {
    const dashboard = page.waitForResponse(
      (response) => response.url().includes("/api/management/dashboard") && response.request().method() === "GET",
    );
    const identity = await loginAs(page, direction);
    expect(identity?.role, "connexion de la direction").toBe("management");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect((await dashboard).status(), "GET /api/management/dashboard").toBe(200);
    await expect(page.getByTestId("kpi-tiles")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /Vue d'ensemble/ })).toBeVisible();
    await expect(page.getByText("Accès refusé", { exact: true })).toHaveCount(0);
  });

  test("KPI et tableaux de bord lus par l'API", async ({ page }) => {
    await loginWithSession(page, direction);
    for (const path of [
      "/api/management/dashboard?period=month",
      "/api/kpi/incidents-per-month",
      "/api/kpi/preventive-compliance",
      "/api/vehicles",
    ]) {
      expect((await page.request.get(path)).status(), `lecture ${path}`).toBe(200);
    }
  });

  test("écran véhicules : lecture, sans bouton d'ajout", async ({ page }) => {
    await loginWithSession(page, direction);
    await page.goto("/vehicles", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Gestion des véhicules" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Ajouter un véhicule" })).toHaveCount(0);
  });

  test("écritures refusées en 403, rien en base", async ({ page }) => {
    await loginWithSession(page, direction);
    const stamp = Date.now().toString(36);

    await expectForbidden(
      await page.request.post("/api/vehicles", {
        data: { registrationNumber: `${PREFIX}${stamp}`, brand: "Test", model: "Test", year: 2020 },
      }),
      "création de véhicule",
    );
    await expectForbidden(
      await page.request.post("/api/work-orders", {
        data: { vehicleId: anyVehicleId, title: `${PREFIX}OT-${stamp}`, type: "corrective" },
      }),
      "création d'OT",
    );
    await expectForbidden(
      await page.request.post("/api/parts", { data: { reference: `${PREFIX}P-${stamp}`, name: "Pièce test" } }),
      "création de fiche pièce",
    );
    await expectForbidden(
      await page.request.post("/api/tires", { data: { brand: `${PREFIX}T-${stamp}`, model: "Test", size: "315/80R22.5" } }),
      "création de fiche pneu",
    );
    await expectForbidden(
      await page.request.post("/api/fuel-records", { data: { vehicleId: anyVehicleId, liters: 10, cost: 1000 } }),
      "saisie carburant",
    );
    await expectForbidden(await page.request.delete(`/api/vehicles/${anyVehicleId}`), "suppression de véhicule");

    expect(await prefixedRows(), "aucune ligne E2E-DIR- écrite").toBe(0);
    expect((await page.request.get(`/api/vehicles/${anyVehicleId}`)).status(), "le véhicule existe toujours").toBe(200);
  });
});
