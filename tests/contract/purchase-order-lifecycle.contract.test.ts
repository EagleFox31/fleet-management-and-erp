import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  alerts,
  parts,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
} from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PO1 : cycle de vie d'une commande fournisseur, par les rôles réels.
 * - Création : lignes manuelles, totaux du serveur, statut `draft` ; technicien refusé ; corps vide 400.
 * - Chaîne : draft -> sent -> confirmed -> partial -> delivered, étape sautée refusée (409).
 * - Réception (partielle ou complète) réservée au magasinier et à l'admin ; code de livraison obligatoire.
 * - Stock : la réception complète ne crédite que le reste après une réception partielle ;
 *   un second « Réception complète » ne crédite rien.
 * - Facture fournisseur créée une seule fois à la réception complète ; clôture refusée tant qu'elle n'est pas payée.
 * Écrit en base ; tout est supprimé.
 */

type Actor = "admin" | "warehouse" | "secretary" | "technician";
const ROLES: Record<Actor, TestUserRole> = {
  admin: "admin",
  warehouse: "warehouse",
  secretary: "secretary",
  technician: "technician",
};

let server: Server;
let baseUrl = "";
let supplierId = 0;
const cookies = new Map<Actor, string>();
const userIdOf = new Map<Actor, number>();
const ids = createIdBag();
const orderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function call(actor: Actor, method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookies.get(actor)!, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (method === "POST" && path === "/api/purchase-orders" && json?.id) orderIds.push(json.id);
  return { status: response.status, body: json };
}

const setStatus = (actor: Actor, orderId: number, status: string, extra: Record<string, unknown> = {}) =>
  call(actor, "PATCH", `/api/purchase-orders/${orderId}/status`, { status, ...extra });

async function createManualOrder(actor: Actor = "admin") {
  return call(actor, "POST", "/api/purchase-orders", {
    supplierId,
    manualLines: [
      { description: "TEST ligne A", quantityOrdered: 2, unitPrice: 1000 },
      { description: "TEST ligne B", quantityOrdered: 1, unitPrice: 500 },
    ],
  });
}

async function orderRow(orderId: number) {
  const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  return row;
}

async function invoicesOf(orderId: number) {
  return db.select().from(supplierInvoices).where(eq(supplierInvoices.purchaseOrderId, orderId));
}

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity;
}

async function orderWithPartLine(status: string, quantityOrdered: number) {
  const part = await createTestPart({ quantity: 10, unitPrice: "1000.00" });
  ids.partIds.push(part.id);
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      status,
      totalAmountHT: String(1000 * quantityOrdered),
      vatAmount: "0",
      totalAmountTTC: String(1000 * quantityOrdered),
      createdBy: userIdOf.get("admin")!,
    } as any)
    .returning();
  orderIds.push(order.id);
  const [line] = await db
    .insert(purchaseOrderLines)
    .values({
      purchaseOrderId: order.id,
      partId: part.id,
      description: "TEST ligne pièce",
      quantityOrdered,
      unitPrice: "1000.00",
      totalPrice: String(1000 * quantityOrdered),
    } as any)
    .returning();
  return { order, line, part };
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;

  for (const actor of Object.keys(ROLES) as Actor[]) {
    const user = await createTestUser({ role: ROLES[actor] });
    ids.userIds.push(user.id);
    userIdOf.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("PO1 création d'une commande", { timeout: 120000 }, () => {
  it("magasinier : 201, brouillon, lignes et totaux calculés par le serveur", async () => {
    const res = await createManualOrder("warehouse");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.lines).toHaveLength(2);
    const row = await orderRow(res.body.id);
    expect(Number(row.totalAmountHT)).toBe(2500);
    expect(Number(row.totalAmountTTC)).toBeGreaterThan(2500);
    expect(row.createdBy).toBe(userIdOf.get("warehouse"));
    expect(row.approvedBy).toBeNull();
  });

  it("technicien : 403, aucune commande créée", async () => {
    const before = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.supplierId, supplierId));
    const res = await createManualOrder("technician");
    expect(res.status).toBe(403);
    const after = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.supplierId, supplierId));
    expect(after.length).toBe(before.length);
  });

  it("sans ligne ni demande : 400 lisible", async () => {
    const res = await call("admin", "POST", "/api/purchase-orders", { supplierId });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SQLSTATE|violates/);
  });
});

describe("PO1 chaîne de statuts par les rôles réels", { timeout: 120000 }, () => {
  it("draft -> sent -> confirmed -> partial -> delivered, facture créée une fois, clôture refusée", async () => {
    const created = await createManualOrder("admin");
    const orderId = created.body.id as number;

    // Étape sautée : un brouillon ne se réceptionne pas.
    const skip = await setStatus("warehouse", orderId, "confirmed");
    expect(skip.status).toBe(409);
    expect((await orderRow(orderId)).status).toBe("draft");

    expect((await setStatus("admin", orderId, "sent")).status).toBe(200);
    const sent = await orderRow(orderId);
    expect(sent.status).toBe("sent");
    expect(sent.approvedBy).toBe(userIdOf.get("admin"));
    expect(sent.approvedAt).not.toBeNull();

    expect((await setStatus("admin", orderId, "confirmed")).status).toBe(200);

    // Réception réservée au magasinier / admin.
    const denied = await setStatus("secretary", orderId, "partial");
    expect(denied.status).toBe(403);
    expect((await orderRow(orderId)).status).toBe("confirmed");

    expect((await setStatus("warehouse", orderId, "partial")).status).toBe(200);

    const noCode = await setStatus("warehouse", orderId, "delivered");
    expect(noCode.status).toBe(400);
    expect(noCode.body.message).toMatch(/code de livraison/i);
    expect((await orderRow(orderId)).status).toBe("partial");

    const delivered = await setStatus("warehouse", orderId, "delivered", { deliveryCode: "TEST-BL-1" });
    expect(delivered.status).toBe(200);
    const done = await orderRow(orderId);
    expect(done.status).toBe("delivered");
    expect(done.deliveryCode).toBe("TEST-BL-1");
    expect(done.actualDeliveryDate).not.toBeNull();

    // Rejouer la réception complète ne crée pas de seconde facture.
    expect((await setStatus("warehouse", orderId, "delivered", { deliveryCode: "TEST-BL-1" })).status).toBe(200);
    const invoices = await invoicesOf(orderId);
    expect(invoices).toHaveLength(1);
    for (const inv of invoices) ids.invoiceIds.push(inv.id);

    // Clôture : la facture n'est pas payée.
    const close = await setStatus("admin", orderId, "completed");
    expect(close.status).toBe(409);
    expect((await orderRow(orderId)).status).toBe("delivered");
  });
});

describe("PO1 réception partielle puis totale, effet sur le stock", { timeout: 120000 }, () => {
  it("2 reçus puis réception complète : le stock ne gagne que le commandé (5), pas 2 + 5", async () => {
    const { order, line, part } = await orderWithPartLine("confirmed", 5);

    const partial = await call("warehouse", "PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 2 });
    expect(partial.status).toBe(200);
    expect(await stockOf(part.id)).toBe(12);
    expect((await setStatus("warehouse", order.id, "partial")).status).toBe(200);

    const full = await setStatus("warehouse", order.id, "delivered", { deliveryCode: "TEST-BL-2" });
    expect(full.status).toBe(200);
    expect(await stockOf(part.id)).toBe(15);

    const [row] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.id));
    expect(row.quantityReceived).toBe(5);

    // Rejeu : rien de plus au stock.
    expect((await setStatus("warehouse", order.id, "delivered", { deliveryCode: "TEST-BL-2" })).status).toBe(200);
    expect(await stockOf(part.id)).toBe(15);
    for (const inv of await invoicesOf(order.id)) ids.invoiceIds.push(inv.id);
  });

  it("réception complète sans réception partielle : stock + quantité commandée", async () => {
    const { order, part } = await orderWithPartLine("confirmed", 3);
    expect((await setStatus("warehouse", order.id, "delivered", { deliveryCode: "TEST-BL-3" })).status).toBe(200);
    expect(await stockOf(part.id)).toBe(13);
    for (const inv of await invoicesOf(order.id)) ids.invoiceIds.push(inv.id);
  });

  it("réception complète par le secrétaire : 403, stock inchangé", async () => {
    const { order, part } = await orderWithPartLine("confirmed", 3);
    const res = await setStatus("secretary", order.id, "delivered", { deliveryCode: "TEST-BL-4" });
    expect(res.status).toBe(403);
    expect(await stockOf(part.id)).toBe(10);
    expect((await orderRow(order.id)).status).toBe("confirmed");
  });
});
