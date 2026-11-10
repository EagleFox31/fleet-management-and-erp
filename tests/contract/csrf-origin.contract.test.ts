import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { eq, inArray, sql } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { FOREIGN_ORIGIN_MESSAGE } from "../../server/middleware/require-same-origin";
import { rejectForeignUpgrade } from "../../server/lib/ws-origin";
import {
  fuelRecords,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
  workOrders,
} from "../../shared/schema";
import { leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestPart, createTestSupplier, createTestSupplierInvoice, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Anti-CSRF par origine. `multipart/form-data` est une requête simple admise par le filtre de type
 * de contenu, et le cookie de session est SameSite=None : une page tierce peut POSTer un multipart
 * vide sur une route qui écrit sans lire son corps. Le contrôle d'origine doit la refuser en 403
 * AVANT tout effet (stock, statut inchangés en base), sans casser l'APK (origines de coque native),
 * les scripts (sans Origin) ni /ws.
 */
const EVIL = { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" };
const APK = { Origin: "capacitor://localhost", "Sec-Fetch-Site": "cross-site" };

const ids = createIdBag();
const orderIds: number[] = [];
const workOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const previousFlags = process.env.FEATURE_FLAGS;
let session: Awaited<ReturnType<typeof startContractActors<"admin">>>;
let vehicleId = 0;
let supplierId = 0;

/** Multipart vide : ce que produit un formulaire `enctype="multipart/form-data"` sans champ. */
function emptyMultipart(path: string, headers: Record<string, string>) {
  return fetch(session.baseUrl + path, {
    method: "POST",
    headers: { Cookie: session.cookies.get("admin")!, ...headers },
    body: new FormData(),
  });
}

async function receivedRequirement() {
  const part = await createTestPart({ quantity: 3, unitPrice: "5000.00" });
  ids.partIds.push(part.id);
  const [workOrder] = await db.insert(workOrders).values({ vehicleId, title: "TEST csrf origine", status: "in_progress" }).returning();
  workOrderIds.push(workOrder.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId: part.id, workOrderId: workOrder.id, vehicleId, quantityNeeded: 1, urgency: "high", reason: "TEST csrf origine", status: "received", requestedBy: session.userIdOf("admin") })
    .returning();
  return { part, workOrder, requirement };
}

async function stock(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  const [moves] = await db.select({ n: sql<number>`count(*)::int` }).from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: row.quantity, movements: moves.n };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "fuel-vouchers=on";
  (global as any).broadcastUpdate = () => {};
  session = await startContractActors({ admin: "admin" }, ids.userIds);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120_000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  if (ids.invoiceIds.length > 0) await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  if (orderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  await cleanupCreated(ids);
  await session.close();
});

describe("Anti-CSRF par origine : écritures /api", { timeout: 120_000 }, () => {
  it("issue : multipart vide cross-site refusé en 403, stock et mouvements inchangés", async () => {
    const { part, workOrder, requirement } = await receivedRequirement();
    const before = await stock(part.id);

    const res = await emptyMultipart(`/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, EVIL);
    const body = await res.json();

    expect(res.status, leakText(body)).toBe(403);
    expect(body.message).toBe(FOREIGN_ORIGIN_MESSAGE);
    expect(leakText(body)).not.toMatch(/evil\.example|sec-fetch|stack/i);
    expect(await stock(part.id)).toEqual(before);
    const [req] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(req.status).toBe("received");
  });

  it("issue : la même requête sans Origin (script) passe et sort la pièce", async () => {
    const { part, workOrder, requirement } = await receivedRequirement();
    const res = await emptyMultipart(`/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stock(part.id)).quantity).toBe(2);
  });

  it("auto-approve : multipart vide cross-site refusé en 403, facture inchangée", async () => {
    const [po] = await db
      .insert(purchaseOrders)
      .values({ orderNumber: uniqueTestToken("PO"), supplierId, orderDate: "2026-01-10", totalAmountTTC: "119250.00" })
      .returning();
    orderIds.push(po.id);
    await db.insert(purchaseOrderLines).values({ purchaseOrderId: po.id, description: "Article de test", quantityOrdered: 2, unitPrice: "59625.00", totalPrice: "119250.00" } as any);
    const invoice = await createTestSupplierInvoice({ supplierId, status: "received", totalTTC: "119250.00" });
    ids.invoiceIds.push(invoice.id);
    await db.update(supplierInvoices).set({ purchaseOrderId: po.id, quantity: "2" }).where(eq(supplierInvoices.id, invoice.id));

    const res = await emptyMultipart("/api/supplier-invoices/auto-approve", EVIL);
    expect(res.status, await res.clone().text()).toBe(403);
    const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(row).toMatchObject({ status: "received", approvedBy: null });
  });

  it("fuel-vouchers/:id/validate : multipart vide cross-site refusé en 403, bon toujours en attente", async () => {
    const record = await createTestFuelRecord({ vehicleId, debitAmount: "0", creditAmount: "0", cost: "50000.00" });
    ids.fuelRecordIds.push(record.id);

    const res = await emptyMultipart(`/api/fuel-vouchers/${record.id}/validate`, EVIL);
    expect(res.status, await res.clone().text()).toBe(403);
    const [row] = await db.select({ s: fuelRecords.validationStatus }).from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.s).toBe("pending");
  });

  it("origine d'une coque native (APK) en cross-site : l'écriture JSON légitime réussit", async () => {
    const part = await createTestPart({ quantity: 3, unitPrice: "5000.00" });
    ids.partIds.push(part.id);
    for (const headers of [APK, { Origin: "https://localhost", "Sec-Fetch-Site": "cross-site" }]) {
      const res = await session.call("POST", `/api/parts/${part.id}/update-stock`, {
        actor: "admin",
        body: { adjustment: 1, reason: "TEST apk" },
        headers,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect((await stock(part.id)).quantity).toBe(5);
  });

  it("origine étrangère refusée aussi en JSON (la défense ne dépend pas du type de contenu)", async () => {
    const part = await createTestPart({ quantity: 3, unitPrice: "5000.00" });
    ids.partIds.push(part.id);
    const res = await session.call("POST", `/api/parts/${part.id}/update-stock`, {
      actor: "admin",
      body: { adjustment: 1, reason: "TEST evil" },
      headers: EVIL,
    });
    expect(res.status).toBe(403);
    expect((await stock(part.id)).quantity).toBe(3);
  });

  it("requête sans Origin ni Sec-Fetch-Site : inchangée", async () => {
    const part = await createTestPart({ quantity: 3, unitPrice: "5000.00" });
    ids.partIds.push(part.id);
    const res = await session.call("POST", `/api/parts/${part.id}/update-stock`, { actor: "admin", body: { adjustment: 1, reason: "TEST sans origine" } });
    expect(res.status).toBe(200);
  });

  it("lecture cross-site : non concernée par le contrôle (GET)", async () => {
    const res = await session.call("GET", "/api/auth/me", { actor: "admin", headers: EVIL });
    expect(res.status).not.toBe(403);
  });
});

/**
 * /ws : le serveur de contrat n'ouvre pas de WebSocket (c'est `server/index.ts`). On branche la vraie
 * fonction de vérification d'upgrade (`rejectForeignUpgrade`, appelée par `server/index.ts`) sur un
 * serveur HTTP réel et on s'y connecte avec le client `ws`.
 */
describe("Anti-CSRF par origine : upgrade /ws", () => {
  let wsServer: Server;
  let url = "";

  beforeAll(async () => {
    const wss = new WebSocketServer({ noServer: true });
    wsServer = createServer();
    wsServer.on("upgrade", (request, socket, head) => {
      if (rejectForeignUpgrade(request, socket)) return;
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    });
    await new Promise<void>((resolve) => wsServer.listen(0, "127.0.0.1", () => resolve()));
    url = `ws://127.0.0.1:${(wsServer.address() as AddressInfo).port}/ws`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
  });

  function open(headers: Record<string, string>) {
    return new Promise<{ opened: boolean; status?: number }>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("open", () => {
        ws.close();
        resolve({ opened: true });
      });
      ws.on("unexpected-response", (_req, res) => resolve({ opened: false, status: res.statusCode }));
      ws.on("error", () => undefined);
    });
  }

  it("Origin étrangère : upgrade refusé en 403", async () => {
    expect(await open({ Origin: "https://evil.example" })).toEqual({ opened: false, status: 403 });
  });

  it("Origin d'une coque native : upgrade accepté", async () => {
    expect(await open({ Origin: "capacitor://localhost" })).toEqual({ opened: true });
  });

  it("sans Origin (client non navigateur) : upgrade accepté", async () => {
    expect(await open({})).toEqual({ opened: true });
  });
});
