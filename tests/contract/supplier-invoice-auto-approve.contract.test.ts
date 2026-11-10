import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { purchaseOrderLines, purchaseOrders, supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Approbation automatique (`POST /api/supplier-invoices/auto-approve`, admin seul) : parcourt les
 * factures `received` et approuve celles dont le TTC et la quantité égalent ceux de la commande liée.
 * Toute autre facture reste en l'état.
 *
 * Isolation : le parcours est global, mais les fichiers de contrat s'exécutent un par un sous verrou
 * de base (`vitest.contract.config.ts`) ; les assertions ne portent que sur les factures du test.
 */

let server: Server;
let baseUrl = "";
let supplierId = 0;
const ids = createIdBag();
const orderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

const ORDER_TTC = "119250.00";
const ORDER_QTY = 2;

async function sessionOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

/** Commande de 2 unités pour 119 250 TTC. */
async function order() {
  const [row] = await db
    .insert(purchaseOrders)
    .values({ orderNumber: uniqueTestToken("PO"), supplierId, orderDate: "2026-01-10", totalAmountTTC: ORDER_TTC })
    .returning();
  orderIds.push(row.id);
  await db.insert(purchaseOrderLines).values({
    purchaseOrderId: row.id,
    description: "Article de test",
    quantityOrdered: ORDER_QTY,
    unitPrice: "59625.00",
    totalPrice: ORDER_TTC,
  } as any);
  return row;
}

async function invoice(opts: {
  withOrder?: boolean;
  totalTTC?: string;
  quantity?: string;
  status?: (typeof supplierInvoices.$inferInsert)["status"];
}) {
  const po = opts.withOrder === false ? null : await order();
  const row = await createTestSupplierInvoice({ supplierId, status: opts.status ?? "received", totalTTC: opts.totalTTC ?? ORDER_TTC });
  ids.invoiceIds.push(row.id);
  await db
    .update(supplierInvoices)
    .set({ purchaseOrderId: po?.id ?? null, quantity: opts.quantity ?? String(ORDER_QTY) })
    .where(eq(supplierInvoices.id, row.id));
  return row;
}

const autoApprove = (cookie?: string) =>
  fetch(`${baseUrl}/api/supplier-invoices/auto-approve`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } });

async function rowOf(id: number) {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
  return row;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  // Factures avant commandes, commandes avant fournisseur (clés étrangères).
  if (ids.invoiceIds.length > 0) await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  if (orderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("POST /api/supplier-invoices/auto-approve", { timeout: 120000 }, () => {
  it("hors admin : 401 sans session, 403 pour la secrétaire et le magasin, facture intacte", async () => {
    const target = await invoice({});
    expect((await autoApprove()).status).toBe(401);
    for (const role of ["secretary", "warehouse"] as const) {
      const { cookie } = await sessionOf(role);
      expect((await autoApprove(cookie)).status, role).toBe(403);
    }
    expect(await rowOf(target.id)).toMatchObject({ status: "received", approvedBy: null });
  });

  it("admin : approuve le rapprochement exact et laisse les écarts, les factures sans commande et les autres statuts", async () => {
    const admin = await sessionOf("admin");
    const exact = await invoice({});
    const smallGap = await invoice({ totalTTC: "121635.00" }); // +2 % : revue manuelle
    const bigGap = await invoice({ totalTTC: "131175.00" }); // +10 % : escalade
    const qtyGap = await invoice({ quantity: "3" });
    const noOrder = await invoice({ withOrder: false });
    const validated = await invoice({ status: "validated" });
    const disputed = await invoice({ status: "disputed" });
    const before = Date.now();

    const res = await autoApprove(admin.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvedCount).toBe(body.approvedInvoices.length);
    expect(body.approvedInvoices).toContain(exact.id);
    for (const other of [smallGap, bigGap, qtyGap, noOrder, validated, disputed]) {
      expect(body.approvedInvoices).not.toContain(other.id);
    }

    const approved = await rowOf(exact.id);
    expect(approved).toMatchObject({
      status: "approved",
      approvedBy: admin.user.id,
      validatedBy: admin.user.id,
      hasDiscrepancy: false,
      totalTTC: exact.totalTTC,
      balance: exact.balance,
    });
    expect(Number(approved.variancePercentage)).toBe(0);
    expect(approved.approvedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);

    for (const [row, status] of [
      [smallGap, "received"],
      [bigGap, "received"],
      [qtyGap, "received"],
      [noOrder, "received"],
      [validated, "validated"],
      [disputed, "disputed"],
    ] as const) {
      expect(await rowOf(row.id), `facture ${row.id}`).toMatchObject({ status, approvedBy: null });
    }
  });
});
