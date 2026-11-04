import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  partRequirements,
  parts,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
} from "../shared/schema";
import { PURCHASE_ORDER_STATUS_LABELS } from "../shared/constants/purchase-order-statuses";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestPart, createTestSupplier } from "../tests/support/factories";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * P6 niveau navigateur : stock bas -> réapprovisionnement.
 *
 * Le contrat (`tests/contract/p6-low-stock-to-restock.contract.test.ts`) prouve le chaînage par HTTP.
 * Ici : l'écran du magasinier (alerte nommée, commande, réception), l'alerte chez un second profil
 * (chef d'atelier) et la TRAME WebSocket qui la lève. La requête `/api/warehouse/reorder-alerts`
 * n'a pas de `refetchInterval` ; on vérifie quand même la trame elle-même (AGENTS.md §3).
 */

const ids = createIdBag();
const orderIds: number[] = [];
const requirementIds: number[] = [];
let warehouse: E2ECredentials & { id: number };
let observer: E2ECredentials & { id: number };
let technician: E2ECredentials & { id: number };
let admin: E2ECredentials & { id: number };
let supplierId = 0;

test.beforeAll(async () => {
  warehouse = await createE2EUser("warehouse", ids);
  observer = await createE2EUser("workshop_manager", ids);
  technician = await createE2EUser("technician", ids);
  admin = await createE2EUser("admin", ids);
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
});

test.afterAll(async () => {
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

async function stockOf(partId: number): Promise<number> {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity ?? 0;
}

async function orderStatus(orderId: number): Promise<string> {
  const [row] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  return row.status;
}

/** Pièce sous son seuil, demande approuvée, commande de brouillon créée par l'admin (API : l'achat n'a pas d'écran de création par demande testé ici). */
async function draftOrderForLowPart(quantityOrdered: number) {
  const part = await createTestPart({ quantity: 8, minQuantity: 5 });
  ids.partIds.push(part.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId: part.id, quantityNeeded: quantityOrdered, reason: "TEST P6 e2e", status: "approved", requestedBy: technician.id })
    .returning();
  requirementIds.push(requirement.id);
  return { part, requirementId: requirement.id };
}

async function createDraftOrder(page: Page, requirementId: number): Promise<number> {
  const created = await page.request.post("/api/purchase-orders", { data: { supplierId, requirementIds: [requirementId] } });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect(body.status).toBe("draft");
  orderIds.push(body.id);
  return body.id as number;
}

function frameType(frame: string): { type?: string } | null {
  try {
    return JSON.parse(frame) as { type?: string };
  } catch {
    return null;
  }
}

/** Trame de commande fournisseur au statut donné, pour cette commande. */
function isOrderStatusFrame(frame: string, orderId: number, status: string): boolean {
  const message = frameType(frame);
  if (message?.type !== "purchase_order_status_updated") return false;
  return new RegExp(String.raw`"orderId":\s*${orderId}\b`).test(frame) && frame.includes(`"status":"${status}"`);
}

async function openSession(context: BrowserContext, user: E2ECredentials, frames?: string[]): Promise<Page> {
  const page = await context.newPage();
  if (frames) {
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/ws")) return;
      socket.on("framereceived", (frame) => {
        frames.push(typeof frame.payload === "string" ? frame.payload : frame.payload.toString());
      });
    });
  }
  await loginWithSession(page, user);
  return page;
}

/** Compteur « Alertes stock magasin » du tableau de bord du chef d'atelier (tuile sans data-testid). */
function observerTile(page: Page) {
  return page.locator("div, button").filter({ hasText: "Alertes stock magasin" }).filter({ hasText: "sous seuil" }).last();
}

async function observerAlertCount(page: Page): Promise<number> {
  const text = (await observerTile(page).innerText()).replace(/\s+/g, " ");
  const match = text.match(/Alertes stock magasin\s+(\d+)/);
  expect(match, `compteur d'alertes lisible dans « ${text} »`).toBeTruthy();
  return Number(match![1]);
}

test.describe("P6 - stock bas -> réapprovisionnement (navigateur)", () => {
  /**
   * Le parcours est joué une fois dans un beforeAll (mise en place), les observations sont relevées dans
   * `seen`, puis chaque test n'affirme qu'un maillon. Le dernier maillon (levée de l'alerte chez l'autre
   * profil SANS rechargement) est un défaut produit figé en test.fail : voir son commentaire.
   */
  test.describe.configure({ mode: "serial" });

  const frames: string[] = [];
  const contexts: BrowserContext[] = [];
  const seen = {
    socketReady: false,
    baseline: -1,
    partId: 0,
    orderId: 0,
    warehouseSawAlert: false,
    observerCountAfterDrop: -1,
    stockAfterDrop: -1,
    statusAfterSend: "",
    statusAfterConfirm: "",
    confirmedLabelShown: false,
    observerCountWhileConfirmed: -1,
    stockWhileConfirmed: -1,
    statusAfterDelivery: "",
    deliveredLabelShown: false,
    stockAfterDelivery: -1,
    movements: [] as Array<{ quantity: number | null; createdBy: number | null }>,
    deliveredFrameSeen: false,
  };
  let observerPage: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const adminCtx = await browser.newContext();
    const warehouseCtx = await browser.newContext();
    const observerCtx = await browser.newContext();
    contexts.push(adminCtx, warehouseCtx, observerCtx);
    const adminPage = await openSession(adminCtx, admin);
    const warehousePage = await openSession(warehouseCtx, warehouse);
    observerPage = await openSession(observerCtx, observer, frames);

    // Observateur (chef d'atelier) branché au temps réel sur son tableau de bord, compteur de départ relevé.
    await observerPage.goto("/", { waitUntil: "domcontentloaded" });
    await observerTile(observerPage).waitFor({ timeout: 60_000 });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !frames.some((f) => f.includes("auth_success"))) await observerPage.waitForTimeout(250);
    seen.socketReady = frames.some((f) => f.includes("auth_success"));
    // La tuile affiche 0 tant que /api/warehouse/reorder-alerts n'a pas répondu : relever la valeur
    // attendue par l'API de la même session, puis attendre que la tuile l'affiche avant de s'en servir
    // comme point de départ. Sans cela, une base qui compte déjà des pièces sous seuil donne 0 puis N+1.
    const alertsResponse = await observerPage.request.get("/api/warehouse/reorder-alerts");
    expect(alertsResponse.ok(), "alertes de réapprovisionnement lisibles par le chef d'atelier").toBeTruthy();
    const expectedBaseline = Number((await alertsResponse.json())?.totalAlerts ?? 0);
    await expect
      .poll(() => observerAlertCount(observerPage), { timeout: 30_000, message: "compteur de départ chargé" })
      .toBe(expectedBaseline);
    seen.baseline = expectedBaseline;

    const { part, requirementId } = await draftOrderForLowPart(10);
    seen.partId = part.id;
    seen.orderId = await createDraftOrder(adminPage, requirementId);

    // Sortie du stock par le magasinier : 8 - 5 = 3 <= seuil 5.
    const out = await warehousePage.request.post(`/api/parts/${part.id}/update-stock`, { data: { adjustment: -5, reason: "TEST P6 sortie" } });
    expect(out.status(), "sortie du stock par le magasinier").toBe(200);
    seen.stockAfterDrop = await stockOf(part.id);
    await warehousePage.goto("/", { waitUntil: "domcontentloaded" });
    seen.warehouseSawAlert = await warehousePage
      .getByText(part.name)
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => true, () => false);
    const dropDeadline = Date.now() + 30_000;
    while (Date.now() < dropDeadline && (await observerAlertCount(observerPage)) !== seen.baseline + 1) await observerPage.waitForTimeout(500);
    seen.observerCountAfterDrop = await observerAlertCount(observerPage);

    // Brouillon -> envoyée -> confirmée par l'écran du magasinier.
    await warehousePage.goto(`/procurement/orders/${seen.orderId}`, { waitUntil: "domcontentloaded" });
    await warehousePage.getByTestId("button-status-sent").click();
    await expect.poll(() => orderStatus(seen.orderId)).toBe("sent");
    seen.statusAfterSend = await orderStatus(seen.orderId);
    await warehousePage.getByTestId("button-status-confirmed").click();
    await expect.poll(() => orderStatus(seen.orderId)).toBe("confirmed");
    seen.statusAfterConfirm = await orderStatus(seen.orderId);
    seen.confirmedLabelShown = await warehousePage
      .getByText(PURCHASE_ORDER_STATUS_LABELS.confirmed)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false);
    seen.stockWhileConfirmed = await stockOf(part.id);
    seen.observerCountWhileConfirmed = await observerAlertCount(observerPage);

    // Réception par le magasinier, par l'écran.
    const frameCountBefore = frames.length;
    await warehousePage.getByTestId("button-status-delivered").click();
    await warehousePage.getByTestId("input-delivery-code").fill("TEST-P6-BL-E2E");
    await warehousePage.getByTestId("button-confirm-delivery").click();
    await expect.poll(() => orderStatus(seen.orderId), { timeout: 30_000 }).toBe("delivered");
    seen.statusAfterDelivery = await orderStatus(seen.orderId);
    seen.deliveredLabelShown = await warehousePage
      .getByText(PURCHASE_ORDER_STATUS_LABELS.delivered)
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false);
    seen.stockAfterDelivery = await stockOf(part.id);
    seen.movements = await db
      .select({ quantity: partsStockMovements.quantity, createdBy: partsStockMovements.createdBy })
      .from(partsStockMovements)
      .where(and(eq(partsStockMovements.partId, part.id), eq(partsStockMovements.movementType, "in")));
    const frameDeadline = Date.now() + 8_000;
    const deliveredFrame = () => frames.slice(frameCountBefore).some((f) => isOrderStatusFrame(f, seen.orderId, "delivered"));
    while (Date.now() < frameDeadline && !deliveredFrame()) await observerPage.waitForTimeout(250);
    seen.deliveredFrameSeen = deliveredFrame();
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()));
  });

  test("témoin : l'observateur est branché au temps réel et la mise en place a abouti", () => {
    expect(seen.socketReady, "socket /ws de l'observateur établie (auth_success)").toBe(true);
    expect(seen.baseline).toBeGreaterThanOrEqual(0);
    expect(seen.statusAfterDelivery).toBe("delivered");
  });

  test("la pièce sous son seuil : l'alerte nommée au magasinier et comptée chez le chef d'atelier", () => {
    expect(seen.stockAfterDrop).toBe(3);
    expect(seen.warehouseSawAlert, "la pièce figure dans les alertes du tableau de bord du magasinier").toBe(true);
    expect(seen.observerCountAfterDrop, "compteur d'alertes du chef d'atelier").toBe(seen.baseline + 1);
  });

  test("la commande passe de brouillon à confirmée par l'écran ; l'alerte et le stock ne bougent pas", () => {
    expect(seen.statusAfterSend).toBe("sent");
    expect(seen.statusAfterConfirm).toBe("confirmed");
    expect(seen.confirmedLabelShown, `libellé « ${PURCHASE_ORDER_STATUS_LABELS.confirmed} » affiché`).toBe(true);
    expect(seen.stockWhileConfirmed).toBe(3);
    expect(seen.observerCountWhileConfirmed).toBe(seen.baseline + 1);
  });

  test("la réception par le magasinier crédite +10 à son nom et émet la trame chez le chef d'atelier", () => {
    expect(seen.deliveredLabelShown, `libellé « ${PURCHASE_ORDER_STATUS_LABELS.delivered} » affiché`).toBe(true);
    expect(seen.stockAfterDelivery).toBe(13);
    expect(seen.movements).toEqual([expect.objectContaining({ quantity: 10, createdBy: warehouse.id })]);
    expect(seen.deliveredFrameSeen, "trame purchase_order_status_updated(delivered) reçue par le chef d'atelier").toBe(true);
  });

  /**
   * Couche 3 (AGENTS.md §2) : la réception émet `purchase_order_status_updated`, dont le gestionnaire client
   * (client/src/hooks/useRealTimeSync.ts) invalide /api/warehouse/reorder-alerts, /api/parts/low-on-stock,
   * /api/part-requirements et /api/parts. Sans ces invalidations l'alerte restait affichée chez les autres
   * profils jusqu'à un rechargement (défaut corrigé, ce test était en test.fail).
   * Mise en place : beforeAll ci-dessus ; ce test ne contient que l'attente de la levée, sans rechargement.
   */
  test("l'alerte se lève chez le chef d'atelier sans rechargement, après la trame de réception", async () => {
    await expect.poll(() => observerAlertCount(observerPage), { timeout: 8_000 }).toBe(seen.baseline);
  });

  test("après rechargement, l'alerte est levée chez le chef d'atelier (l'état serveur est juste)", async () => {
    await observerPage.reload({ waitUntil: "domcontentloaded" });
    await observerTile(observerPage).waitFor({ timeout: 60_000 });
    await expect.poll(() => observerAlertCount(observerPage), { timeout: 15_000 }).toBe(seen.baseline);
  });

  test("le technicien ne peut pas réceptionner : bouton absent, 403, stock inchangé", async ({ browser }) => {
    test.setTimeout(180_000);
    const adminCtx = await browser.newContext();
    const techCtx = await browser.newContext();
    try {
      const adminPage = await openSession(adminCtx, admin);
      const { part, requirementId } = await draftOrderForLowPart(4);
      const orderId = await createDraftOrder(adminPage, requirementId);
      for (const status of ["sent", "confirmed"]) {
        const res = await adminPage.request.patch(`/api/purchase-orders/${orderId}/status`, { data: { status } });
        expect(res.status()).toBe(200);
      }
      // Sert de témoin : la commande est bien confirmée, donc le bouton existerait pour un magasinier.
      expect(await orderStatus(orderId)).toBe("confirmed");

      const techPage = await openSession(techCtx, technician);
      await techPage.goto(`/procurement/orders/${orderId}`, { waitUntil: "domcontentloaded" });
      await expect(techPage.getByTestId("button-status-delivered")).toHaveCount(0);

      const denied = await techPage.request.patch(`/api/purchase-orders/${orderId}/status`, {
        data: { status: "delivered", deliveryCode: "TEST-P6-X" },
      });
      expect(denied.status()).toBe(403);
      expect(await stockOf(part.id)).toBe(8);
      expect(await orderStatus(orderId)).toBe("confirmed");
    } finally {
      await Promise.all([adminCtx.close(), techCtx.close()]);
    }
  });
});
