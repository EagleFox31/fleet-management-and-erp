import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { activityLogs, tires, vehicleTires } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * TIR3 niveau UI — démontage d'un pneu vers le stock, deux rôles :
 * - le chef d'atelier démonte depuis « Pneus montés » ; la destination est
 *   obligatoire, un double clic n'envoie qu'une requête (AGENTS.md §10) ;
 * - le magasinier, sur le suivi pneus, reçoit la trame `vehicle_tire_removed`
 *   avec `destination: "stock"` (AGENTS.md §3) ; la fiche regagne une unité.
 */

const ids = createIdBag();
const tireIds: number[] = [];
let workshopManager: E2ECredentials & { id: number };
let warehouse: E2ECredentials & { id: number };
let tireId: number;
let vehicleTireId: number;

test.beforeAll(async () => {
  workshopManager = await createE2EUser("workshop_manager", ids);
  warehouse = await createE2EUser("warehouse", ids);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [tire] = await db
    .insert(tires)
    .values({ brand: "TEST-MARQUE", model: uniqueTestToken("e2e-tire"), size: "315/80R22.5", stockQuantity: 0 })
    .returning();
  tireIds.push(tire.id);
  tireId = tire.id;
  const [mounted] = await db
    .insert(vehicleTires)
    .values({
      vehicleId: vehicle.id,
      tireId,
      position: "front_left",
      installationDate: "2026-10-01",
      installationMileage: 1000,
    })
    .returning();
  vehicleTireId = mounted.id;
});

test.afterAll(async () => {
  if (tireIds.length > 0) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  }
  await cleanupCreated(ids);
});

test("chef d'atelier : le pneu démonté revient en stock, le magasin est prévenu en temps réel", async ({ browser }) => {
  test.setTimeout(120_000);
  const warehouseContext = await browser.newContext();
  const workshopContext = await browser.newContext();

  try {
    const warehousePage = await warehouseContext.newPage();
    const frames: string[] = [];
    warehousePage.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      socket.on("framereceived", (frame) => {
        frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
      });
    });
    await loginWithSession(warehousePage, warehouse);
    await warehousePage.goto("/inventory/tires", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => frames.some((frame) => frame.includes("auth_success")), {
        message: "La session magasinier n'a pas ouvert la connexion temps réel /ws",
        timeout: 20_000,
      })
      .toBe(true);

    const page = await workshopContext.newPage();
    const removeCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().includes(`/api/vehicle-tires/${vehicleTireId}/remove`)) {
        removeCalls.push(request.url());
      }
    });
    await loginWithSession(page, workshopManager);
    await page.goto("/inventory/tires", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-mounted").click();
    await page.getByTestId(`button-remove-tire-${vehicleTireId}`).click();

    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByTestId("button-confirm-tire-removal");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Kilométrage au démontage").fill("500");
    await expect(dialog.getByText(/kilométrage au montage/)).toBeVisible();
    await dialog.getByLabel("Kilométrage au démontage").fill("42000");
    await dialog.getByText("Remettre en stock").click();
    await confirm.dblclick();

    await expect(page.locator('li[role="status"]').filter({ hasText: "Pneu démonté" })).toBeVisible();
    expect(removeCalls).toHaveLength(1);
    await expect(page.getByTestId(`button-remove-tire-${vehicleTireId}`)).toHaveCount(0);

    await expect
      .poll(
        () =>
          frames.some(
            (frame) =>
              frame.includes("vehicle_tire_removed") &&
              frame.includes(`"vehicleTireId":${vehicleTireId}`) &&
              frame.includes('"destination":"stock"'),
          ),
        { message: "Aucune trame 'vehicle_tire_removed' reçue par le magasinier", timeout: 15_000 },
      )
      .toBe(true);

    const [stock] = await db.select().from(tires).where(eq(tires.id, tireId));
    expect(stock).toMatchObject({ stockQuantity: 1, updatedBy: workshopManager.id });
    const [mounting] = await db.select().from(vehicleTires).where(eq(vehicleTires.id, vehicleTireId));
    expect(mounting).toMatchObject({ status: "removed", removalMileage: 42000 });
  } finally {
    await warehouseContext.close();
    await workshopContext.close();
  }
});
