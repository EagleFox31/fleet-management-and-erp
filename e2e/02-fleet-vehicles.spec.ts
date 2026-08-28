import { test, expect } from "@playwright/test";
import { loginAndOpen } from "./helpers/auth";

test.describe("Critical Journey 2 - Flotte/Vehicules", () => {
  test("liste vehicules accessible + workflow acquisition disponible", async ({ page }) => {
    await loginAndOpen(page, "/vehicles");

    await expect(page.getByRole("heading", { name: "Gestion des véhicules", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Véhicules", level: 2 })).toBeVisible();

    const vehiclesResponse = await page.request.get("/api/vehicles?limit=10&offset=0");
    expect(vehiclesResponse.ok()).toBeTruthy();
    const vehiclesPayload = await vehiclesResponse.json();
    expect(Array.isArray(vehiclesPayload.vehicles)).toBeTruthy();

    await page.goto("/workflows/vehicle-acquisition", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Acquisition de Véhicule", level: 1 })).toBeVisible();
    await expect(page.getByText("Progression")).toBeVisible();
  });
});
