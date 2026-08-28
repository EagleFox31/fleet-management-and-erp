import { test, expect } from "@playwright/test";
import { loginAndOpen } from "./helpers/auth";

test.describe("Critical Journey 3 - Ordres de Travail", () => {
  test("consultation OT + filtres et stats", async ({ page }) => {
    await loginAndOpen(page, "/maintenance/work-orders");

    await expect(page.getByRole("heading", { name: "Ordres de travail", level: 1 })).toBeVisible();
    await expect(page.getByTestId("filter-all")).toBeVisible();
    await expect(page.getByTestId("filter-pending")).toBeVisible();
    await expect(page.getByTestId("filter-in-progress")).toBeVisible();
    await expect(page.getByTestId("filter-awaiting-parts")).toBeVisible();

    const statsResponse = await page.request.get("/api/work-orders/statistics?period=month");
    expect(statsResponse.ok()).toBeTruthy();

    const statsPayload = await statsResponse.json();
    expect(typeof statsPayload.pending).toBe("number");
    expect(typeof statsPayload.completed).toBe("number");
  });
});
