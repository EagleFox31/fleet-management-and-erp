import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { purchaseOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, erreurs des commandes fournisseur (`/api/purchase-orders`).
 * - T3 : identifiant illisible -> 400 ; commande inconnue -> 404 ; statut hors liste -> 400.
 * - Transition interdite ou clôture sans facture payée -> 409, message lisible en libellés
 *   d'écran (« Annulée », « Transmise fournisseur »), jamais le code technique ni `details`.
 * - Toute réponse d'erreur suit le contrat commun `{ message, code, requestId }`.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let adminId = 0;
let supplierId = 0;
const ids = createIdBag();
const orderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(res.body).not.toHaveProperty("details");
  expect(JSON.stringify(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|->/);
}

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function orderIn(status: string) {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      status,
      createdBy: adminId,
    } as any)
    .returning();
  orderIds.push(order.id);
  return order;
}

async function statusOf(orderId: number) {
  const [row] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  return row.status;
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
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (orderIds.length > 0) {
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Commandes fournisseur : erreurs au contrat commun", { timeout: 120000 }, () => {
  it("PATCH statut, identifiant illisible -> 400", async () => {
    const res = await call("PATCH", "/api/purchase-orders/abc/status", { status: "sent" });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });

  it("PATCH statut, commande inconnue -> 404", async () => {
    const res = await call("PATCH", "/api/purchase-orders/2147483000/status", { status: "sent" });
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("PATCH statut hors liste -> 400, rien n'est écrit", async () => {
    const order = await orderIn("draft");
    const res = await call("PATCH", `/api/purchase-orders/${order.id}/status`, { status: "perdue" });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(await statusOf(order.id)).toBe("draft");
  });

  it("transition interdite -> 409 en libellés d'écran, rien n'est écrit", async () => {
    const order = await orderIn("cancelled");
    const res = await call("PATCH", `/api/purchase-orders/${order.id}/status`, { status: "sent" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toContain("Annulée");
    expect(res.body.message).toContain("Transmise fournisseur");
    expect(res.body.message).not.toMatch(/\bcancelled\b|\bsent\b/);
    expect(await statusOf(order.id)).toBe("cancelled");
  });

  it("clôture sans facture fournisseur -> 409 lisible, commande inchangée", async () => {
    const order = await orderIn("delivered");
    const res = await call("PATCH", `/api/purchase-orders/${order.id}/status`, { status: "completed" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toMatch(/facture/i);
    expect(await statusOf(order.id)).toBe("delivered");
  });

  it("GET détail, identifiant illisible -> 400 ; commande inconnue -> 404", async () => {
    const bad = await call("GET", "/api/purchase-orders/abc");
    expect(bad.status).toBe(400);
    expectErrorContract(bad, "VALIDATION");

    const missing = await call("GET", "/api/purchase-orders/2147483000");
    expect(missing.status).toBe(404);
    expectErrorContract(missing, "NOT_FOUND");
  });

  it("POST optimisation, fournisseur illisible -> 400", async () => {
    const res = await call("POST", "/api/purchase-orders/optimize-timing/abc");
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });
});
