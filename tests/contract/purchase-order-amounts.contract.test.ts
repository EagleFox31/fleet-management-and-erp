import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, parts, partsStockMovements, purchaseOrderLines, purchaseOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { leakText } from "../support/api-error";

/**
 * Commande fournisseur : les montants et les quantités reçues sont ceux du
 * serveur. Remise hors de 0..100 refusée (sinon total négatif ou gonflé),
 * total envoyé par le client ignoré. Sur une ligne : quantité reçue entière,
 * jamais négative, jamais au-delà du commandé, jamais en baisse (le stock ne
 * suivrait pas) ; la ligne doit appartenir à la commande de l'URL. Refus :
 * rien n'est écrit, le stock reste intact. Écrit en base ; tout est supprimé.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let adminId = 0;
const ids = createIdBag();
const orderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function orderWithPartLine(quantityOrdered: number) {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const part = await createTestPart({ quantity: 10, unitPrice: "1000.00" });
  ids.partIds.push(part.id);
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: `TEST-PO-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      supplierId: supplier.id,
      orderDate: new Date().toISOString().slice(0, 10),
      status: "sent",
      createdBy: adminId,
    } as any)
    .returning();
  orderIds.push(order.id);
  const [line] = await db
    .insert(purchaseOrderLines)
    .values({
      purchaseOrderId: order.id,
      partId: part.id,
      description: "TEST ligne",
      quantityOrdered,
      unitPrice: "1000.00",
      totalPrice: String(1000 * quantityOrdered),
    } as any)
    .returning();
  return { order, line, part };
}

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity;
}

async function receivedOf(lineId: number) {
  const [row] = await db
    .select({ received: purchaseOrderLines.quantityReceived })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.id, lineId));
  return row.received ?? 0;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  adminId = admin.id;
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (orderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.supplierIds.length > 0) {
    const created = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(inArray(purchaseOrders.supplierId, ids.supplierIds));
    if (created.length > 0) {
      const createdIds = created.map((o) => o.id);
      await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, createdIds));
      await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, createdIds));
    }
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Commande fournisseur : montants calculés par le serveur", { timeout: 120000 }, () => {
  it("remise hors de 0..100 : 400 lisible, aucune commande créée", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);

    for (const discountPercentage of [150, -20]) {
      const res = await call("POST", "/api/purchase-orders", {
        supplierId: supplier.id,
        manualLines: [{ description: "TEST", quantityOrdered: 2, unitPrice: 1000 }],
        discountPercentage,
      });
      expect(res.status, String(discountPercentage)).toBe(400);
      expect(leakText(res.body)).not.toMatch(/ZodError|stack|at Object/);
    }
    const created = await db.select().from(purchaseOrders).where(eq(purchaseOrders.supplierId, supplier.id));
    expect(created).toHaveLength(0);
  });

  it("total envoyé par le client ignoré : HT, TVA et TTC recalculés", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);

    const res = await call("POST", "/api/purchase-orders", {
      supplierId: supplier.id,
      manualLines: [{ description: "TEST", quantityOrdered: 2, unitPrice: 1000 }],
      discountPercentage: 10,
      totalAmountTTC: "1",
      totalAmountHT: "1",
    });
    expect(res.status).toBe(201);
    const [stored] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, res.body.id));
    orderIds.push(stored.id);
    expect(Number(stored.totalAmountHT)).toBe(2000);
    expect(Number(stored.discountAmount)).toBe(200);
    expect(Number(stored.totalAmountTTC)).toBeGreaterThan(1800);
  });
});

describe("PATCH /api/purchase-orders/:id/lines/:lineId : quantités reçues", { timeout: 120000 }, () => {
  it("quantité négative ou décimale : 400, rien n'est écrit", async () => {
    const { order, line, part } = await orderWithPartLine(2);

    for (const quantityReceived of [-100, 1.5]) {
      const res = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived });
      expect(res.status, String(quantityReceived)).toBe(400);
    }
    expect(await receivedOf(line.id)).toBe(0);
    expect(await stockOf(part.id)).toBe(10);
  });

  it("au-delà du commandé : 400, stock intact ; dans la limite : stock crédité de l'écart", async () => {
    const { order, line, part } = await orderWithPartLine(2);

    const over = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 1000 });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/commandé/);
    expect(await stockOf(part.id)).toBe(10);

    const partial = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 1 });
    expect(partial.status).toBe(200);
    expect(await stockOf(part.id)).toBe(11);

    const full = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 2 });
    expect(full.status).toBe(200);
    expect(await stockOf(part.id)).toBe(12);
  });

  it("baisse de la quantité reçue : 409, le stock ne bouge pas", async () => {
    const { order, line, part } = await orderWithPartLine(3);
    expect((await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 2 })).status).toBe(200);

    const down = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 0 });
    expect(down.status).toBe(409);
    expect(await receivedOf(line.id)).toBe(2);
    expect(await stockOf(part.id)).toBe(12);
  });

  it("acceptées + refusées au-delà du reçu : 400", async () => {
    const { order, line } = await orderWithPartLine(3);
    const res = await call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, {
      quantityReceived: 2,
      quantityAccepted: 2,
      quantityRejected: 1,
    });
    expect(res.status).toBe(400);
    expect(await receivedOf(line.id)).toBe(0);
  });

  it("ligne d'une autre commande : 404, rien n'est écrit", async () => {
    const first = await orderWithPartLine(2);
    const second = await orderWithPartLine(2);

    const res = await call("PATCH", `/api/purchase-orders/${first.order.id}/lines/${second.line.id}`, { quantityReceived: 1 });
    expect(res.status).toBe(404);
    expect(await receivedOf(second.line.id)).toBe(0);
    expect(await stockOf(second.part.id)).toBe(10);
  });

  it("deux réceptions simultanées de la même quantité : le stock n'est crédité qu'une fois", async () => {
    const { order, line, part } = await orderWithPartLine(4);

    const results = await Promise.all(
      [1, 2].map(() => call("PATCH", `/api/purchase-orders/${order.id}/lines/${line.id}`, { quantityReceived: 4 })),
    );
    // Le second appel est soit un rejeu sans effet (200), soit refusé (409).
    expect(results.map((r) => r.status)).toContain(200);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(await receivedOf(line.id)).toBe(4);
    expect(await stockOf(part.id)).toBe(14);
  });
});
