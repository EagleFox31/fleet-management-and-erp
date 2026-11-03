import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import {
  alerts,
  partRequirements,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
  workOrders,
} from "../../shared/schema";
import { broadcastAlertCreated as broadcastRenewalAlert } from "../../server/api/document-renewals.routes";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Couche 2 des alertes de réception (AGENTS.md §2 et §3).
 * La réception d'une pièce attendue par un OT en attente crée une alerte pour le chef
 * d'atelier et pour le technicien de l'OT. Sans trame `alert_created`, ni la cloche ni le
 * toast ne bougeaient chez eux. Le magasinier réceptionne ; on vérifie la trame reçue par
 * deux autres rôles (chef d'atelier, technicien), sa portée nominative et sa charge à plat
 * (ce que lit `useRealTimeSync` pour le toast).
 */

type Frame = { eventType: string; data: any };

let server: Server;
let baseUrl = "";
let supplierId = 0;
let warehouseCookie = "";
let managerId = 0;
let technicianId = 0;
let warehouseId = 0;
const ids = createIdBag();
const orderIds: number[] = [];
const workOrderIds: number[] = [];
const frames: Frame[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
/** Fait échouer le prochain envoi d'alert_created (panne de socket simulée). */
let failNextAlertFrame = false;

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: unknown) => {
    if (eventType === "alert_created" && failNextAlertFrame) {
      failNextAlertFrame = false;
      throw new Error("TEST envoi impossible");
    }
    frames.push({ eventType, data });
  });
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;

  const manager = await createTestUser({ role: "workshop_manager" });
  const technician = await createTestUser({ role: "technician" });
  const warehouse = await createTestUser({ role: "warehouse" });
  ids.userIds.push(manager.id, technician.id, warehouse.id);
  managerId = manager.id;
  technicianId = technician.id;
  warehouseId = warehouse.id;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: warehouse.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  warehouseCookie = login.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (workOrderIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

/** Commande confirmée d'une pièce attendue par un OT en attente de pièces, assigné au technicien. */
async function awaitedPartOrder() {
  const part = await createTestPart({ quantity: 0, unitPrice: "1000.00" });
  ids.partIds.push(part.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST OT en attente de pièce", status: "awaiting_parts", technicianId })
    .returning();
  workOrderIds.push(workOrder.id);
  await db.insert(partRequirements).values({
    partId: part.id,
    workOrderId: workOrder.id,
    quantityNeeded: 1,
    reason: "TEST pièce attendue",
    status: "approved",
    requestedBy: technicianId,
  });
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      status: "confirmed",
      totalAmountHT: "2000",
      vatAmount: "0",
      totalAmountTTC: "2000",
      createdBy: warehouseId,
    } as any)
    .returning();
  orderIds.push(order.id);
  const [line] = await db
    .insert(purchaseOrderLines)
    .values({
      purchaseOrderId: order.id,
      partId: part.id,
      description: "TEST ligne pièce attendue",
      quantityOrdered: 2,
      unitPrice: "1000.00",
      totalPrice: "2000",
    } as any)
    .returning();
  return { order, line, workOrder };
}

const patch = (path: string, body: unknown) =>
  fetch(baseUrl + path, {
    method: "PATCH",
    headers: { Cookie: warehouseCookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Trames alert_created adressées à un utilisateur. */
const alertFramesFor = (userId: number) =>
  frames.filter((f) => f.eventType === "alert_created" && f.data?.scope?.type === "user" && f.data.scope.userIds?.includes(userId));

/** Aucune trame alert_created ne part hors portée nominative (ni broadcast, ni rôles). */
function expectAllAlertFramesNominative() {
  const all = frames.filter((f) => f.eventType === "alert_created");
  expect(all.length).toBeGreaterThan(0);
  for (const f of all) {
    expect(f.data?.scope?.type).toBe("user");
    expect(f.data.scope.userIds).toHaveLength(1);
  }
}

function expectAlertFrame(userId: number, title: string) {
  const mine = alertFramesFor(userId).filter((f) => f.data.payload?.title === title);
  expect(mine).toHaveLength(1);
  const { payload, scope, entityId } = mine[0].data;
  expect(scope).toEqual({ type: "user", userIds: [userId] });
  expect(payload.alertId).toBe(entityId);
  expect(typeof payload.message).toBe("string");
  expect(payload.link).toBeTruthy();
  return payload.alertId as number;
}

describe("réception de pièces : trame alert_created vers l'atelier", { timeout: 120000 }, () => {
  it("réception partielle d'une ligne (part_received) : chef d'atelier et technicien notifiés en temps réel", async () => {
    const { order, line } = await awaitedPartOrder();
    frames.length = 0;
    const res = await patch(`/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 1 });
    expect(res.status).toBe(200);

    const managerAlert = expectAlertFrame(managerId, "Pièce reçue");
    const technicianAlert = expectAlertFrame(technicianId, "Pièce disponible");
    // La trame désigne l'alerte réellement écrite pour ce destinataire.
    const rows = await db.select({ id: alerts.id, userId: alerts.userId }).from(alerts).where(inArray(alerts.id, [managerAlert, technicianAlert]));
    expect(rows.map((r) => r.userId).sort()).toEqual([managerId, technicianId].sort());
    // Le magasinier, qui réceptionne, n'est pas destinataire.
    expect(alertFramesFor(warehouseId)).toEqual([]);
    expectAllAlertFramesNominative();
    expect(frames.some((f) => f.eventType === "part_received")).toBe(true);
  });

  it("réception complète de la commande (parts_delivered) : chef d'atelier et technicien notifiés en temps réel", async () => {
    const { order, workOrder } = await awaitedPartOrder();
    frames.length = 0;
    const res = await patch(`/api/purchase-orders/${order.id}/status`, { status: "delivered", deliveryCode: "TEST-BL-RT" });
    expect(res.status).toBe(200);
    for (const inv of await db.select({ id: supplierInvoices.id }).from(supplierInvoices).where(eq(supplierInvoices.purchaseOrderId, order.id))) {
      ids.invoiceIds.push(inv.id);
    }

    expectAlertFrame(managerId, "Livraison reçue - Pièces disponibles");
    const technicianAlert = alertFramesFor(technicianId).find((f) => f.data.payload?.title === "Pièces disponibles pour vos OT");
    expect(technicianAlert?.data.payload.link).toBe(`/maintenance/work-orders/${workOrder.id}`);
    expect(alertFramesFor(warehouseId)).toEqual([]);
    expectAllAlertFramesNominative();
    expect(frames.some((f) => f.eventType === "parts_delivered")).toBe(true);
  });

  it("un envoi raté ne coupe ni les trames suivantes ni parts_delivered", async () => {
    const { order } = await awaitedPartOrder();
    frames.length = 0;
    failNextAlertFrame = true;
    const res = await patch(`/api/purchase-orders/${order.id}/status`, { status: "delivered", deliveryCode: "TEST-BL-RT2" });
    expect(res.status).toBe(200);
    for (const inv of await db.select({ id: supplierInvoices.id }).from(supplierInvoices).where(eq(supplierInvoices.purchaseOrderId, order.id))) {
      ids.invoiceIds.push(inv.id);
    }

    expect(failNextAlertFrame).toBe(false);
    // Au moins deux alertes (chef d'atelier, technicien) : la première échoue, la suite part.
    expectAllAlertFramesNominative();
    expect(frames.some((f) => f.eventType === "parts_delivered")).toBe(true);
  });
});

describe("renouvellement de document : même forme de trame", () => {
  it("charge à plat (titre, message, lien lisibles par le toast), portée nominative", () => {
    frames.length = 0;
    broadcastRenewalAlert({ id: 7, userId: 42, title: "TEST titre", type: "maintenance", priority: "high", link: "/vehicles/1", message: "TEST message" });
    expect(frames).toHaveLength(1);
    expect(frames[0].data.scope).toEqual({ type: "user", userIds: [42] });
    expect(frames[0].data.payload).toMatchObject({ alertId: 7, title: "TEST titre", message: "TEST message", link: "/vehicles/1", priority: "high" });
  });
});
