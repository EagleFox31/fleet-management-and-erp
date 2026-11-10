import { expect, test } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { activityLogs, workOrderItems, workOrders } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Lot V3, point 2 : historique d'un ordre de travail (P-13), activé par défaut après recette.
 * Le chef d'atelier ouvre la fiche, suit le lien « Historique » et lit la chronologie du plus
 * ancien au plus récent (changement de statut en français, auteur). Le chauffeur, hors
 * WORK_ORDER_COST_READ_ROLES, n'a ni lien ni écran. Les écritures auditées sont semées en base :
 * la route lit `activity_logs` (entityType « work_order »).
 */

const ids = createIdBag();
let woId = 0;
let manager: E2ECredentials & { id: number };
let driver: E2ECredentials;

test.beforeAll(async () => {
  manager = await createE2EUser("workshop_manager", ids);
  driver = await createE2EUser("driver", ids);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [wo] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, technicianId: manager.id, title: uniqueTestToken("hist"), status: "in_progress", startDate: new Date() })
    .returning();
  woId = wo.id;
  const base = Date.now();
  await db.insert(activityLogs).values([
    { userId: manager.id, action: "CREATE", entityType: "work_order", entityId: wo.id, method: "POST", path: "/api/work-orders", details: { title: "x" }, createdAt: new Date(base - 120_000) },
    { userId: manager.id, action: "UPDATE", entityType: "work_order", entityId: wo.id, method: "PATCH", path: `/api/work-orders/${wo.id}`, details: { status: "in_progress" }, createdAt: new Date(base - 60_000) },
  ]);
});

test.afterAll(async () => {
  if (woId) {
    await db.delete(activityLogs).where(and(eq(activityLogs.entityType, "work_order"), eq(activityLogs.entityId, woId)));
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, [woId]));
    await db.delete(workOrders).where(eq(workOrders.id, woId));
  }
  await cleanupCreated(ids);
});

test("chef d'atelier : lien Historique depuis la fiche, chronologie du plus ancien au plus récent", async ({ page }) => {
  await loginWithSession(page, manager);
  await page.goto(`/maintenance/work-orders/${woId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("button-work-order-history").click();
  await expect(page).toHaveURL(new RegExp(`/maintenance/work-orders/${woId}/history$`), { timeout: 20_000 });

  const entries = page.locator('[data-testid^="work-order-history-entry-"]');
  await expect(entries).toHaveCount(2, { timeout: 20_000 });
  await expect(entries.nth(0)).toContainText("Création");
  await expect(entries.nth(1)).toContainText("Modification");
  await expect(entries.nth(1)).toContainText("Statut : En cours");
  await expect(entries.nth(1)).toContainText(`par ${manager.username}`);
  // Les corps de requête bruts ne sont pas affichés.
  await expect(page.getByTestId("work-order-history")).not.toContainText('"status"');

  await page.getByTestId("work-order-history-back").click();
  await expect(page).toHaveURL(new RegExp(`/maintenance/work-orders/${woId}$`), { timeout: 20_000 });
});

test("chauffeur : ni écran d'historique ni données", async ({ page }) => {
  await loginWithSession(page, driver);
  await page.goto(`/maintenance/work-orders/${woId}/history`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("work-order-history")).toHaveCount(0);
  await expect(page.locator('[data-testid^="work-order-history-entry-"]')).toHaveCount(0);
});
