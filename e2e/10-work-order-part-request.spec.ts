import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { partRequirements, parts, partsStockMovements, partsUsed, workOrders, type Part, type WorkOrder } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestPart, createTestVehicle } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * « Demander la pièce » depuis l'OT, niveau UI, deux rôles :
 * - le technicien demande 3 unités d'une pièce dont 1 seule est en stock ;
 *   l'écran annonce le partage avant l'envoi, un double clic n'envoie qu'une
 *   requête (AGENTS.md §10) ;
 * - le magasinier, sur ses demandes, reçoit la trame `part_requirement_created`
 *   (preuve temps réel que le polling ne peut pas produire, AGENTS.md §3).
 */

const ids = createIdBag();
const workOrderIds: number[] = [];
let technician: E2ECredentials & { id: number };
let warehouse: E2ECredentials & { id: number };
let part: Part;
let workOrder: WorkOrder;

test.beforeAll(async () => {
  technician = await createE2EUser("technician", ids);
  warehouse = await createE2EUser("warehouse", ids);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  // Référence en tête de tri : le sélecteur liste le catalogue par référence.
  part = await createTestPart({ quantity: 1, reference: `0000-${uniqueTestToken("e2e")}` });
  ids.partIds.push(part.id);
  [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST e2e demande de pièce", status: "in_progress", technicianId: technician.id })
    .returning();
  workOrderIds.push(workOrder.id);
});

test.afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

test("technicien : le disponible sort, le manquant part en demande, le magasin est prévenu en temps réel", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const warehouseContext = await browser.newContext();
  const technicianContext = await browser.newContext();

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
    await warehousePage.goto("/inventory/requests", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => frames.some((frame) => frame.includes("auth_success")), {
        message: "La session magasinier n'a pas ouvert la connexion temps réel /ws",
        timeout: 20_000,
      })
      .toBe(true);

    const page = await technicianContext.newPage();
    const postCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes(`/api/work-orders/${workOrder.id}/parts`)) {
        postCalls.push(request.url());
      }
    });
    await loginWithSession(page, technician);
    await page.goto(`/maintenance/work-orders/${workOrder.id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /^Pièces/ }).click();
    await page.getByRole("button", { name: "Demander une pièce" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(part.reference!) }).click();
    await dialog.getByLabel("Quantité").fill("3");

    const preview = dialog.getByTestId("part-request-preview");
    await expect(preview).toContainText("1 unité(s) sortiront du stock pour cet OT.");
    await expect(preview).toContainText("Une demande sera créée pour 2 unité(s) manquante(s).");
    await expect(preview).toContainText("L'OT passera en attente de pièces.");

    await dialog.getByTestId("btn-add-part-confirm").dblclick();

    await expect(page.locator('li[role="status"]').filter({ hasText: "Pièce demandée" })).toBeVisible();
    expect(postCalls).toHaveLength(1);

    await expect
      .poll(
        () =>
          frames.some(
            (frame) => frame.includes("part_requirement_created") && frame.includes(`"workOrderId":${workOrder.id}`),
          ),
        { message: "Aucune trame 'part_requirement_created' reçue par le magasinier", timeout: 15_000 },
      )
      .toBe(true);

    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(0);
    const lines = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrder.id));
    expect(lines.map((l) => l.quantity)).toEqual([1]);
    const requirements = await db.select().from(partRequirements).where(eq(partRequirements.workOrderId, workOrder.id));
    expect(requirements.map((r) => [r.status, r.quantityNeeded])).toEqual([["pending", 2]]);
    const [current] = await db.select().from(workOrders).where(eq(workOrders.id, workOrder.id));
    expect(current.status).toBe("awaiting_parts");
  } finally {
    await warehouseContext.close();
    await technicianContext.close();
  }
});
