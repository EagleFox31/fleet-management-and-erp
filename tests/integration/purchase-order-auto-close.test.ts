import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { threeWayMatchingService } from "../../server/services/three-way-matching-service";
import { purchaseOrders, supplierInvoices, type SupplierInvoice } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Clôture automatique d'une commande livrée quand toutes ses factures sont soldées.
 * Deux factures soldées en même temps déclenchent deux clôtures : une seule transition
 * `delivered -> completed`, une seule ligne [TRACE_PO], les notes existantes conservées.
 *
 * L'étape appelée est celle que `reconcileInvoiceSettlement` lance après son commit.
 */

const NOTES = "Livraison complète, bon signé.";
const ids = createIdBag();
const orderIds: number[] = [];
let supplierId = 0;
let actorId = 0;

type AutoClose = (invoice: SupplierInvoice, actorId?: number) => Promise<void>;
const autoClose: AutoClose = (invoice, actor) =>
  (threeWayMatchingService as unknown as { autoCloseDeliveredOrderIfFinanceDone: AutoClose })
    .autoCloseDeliveredOrderIfFinanceDone(invoice, actor);

beforeAll(async () => {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
  const user = await createTestUser({ role: "secretary" });
  ids.userIds.push(user.id);
  actorId = user.id;
});

afterAll(async () => {
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  await cleanupCreated(ids);
});

async function orderWithInvoices(orderStatus: string, invoiceStatuses: string[]) {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      status: orderStatus,
      totalAmountHT: "100000",
      vatAmount: "0",
      totalAmountTTC: "100000",
      notes: NOTES,
      createdBy: actorId,
    } as any)
    .returning();
  orderIds.push(order.id);
  const invoices: SupplierInvoice[] = [];
  for (const status of invoiceStatuses) {
    const created = await createTestSupplierInvoice({ supplierId, status: status as any });
    ids.invoiceIds.push(created.id);
    // La fabrique ne transmet pas `purchaseOrderId` : rattachement explicite à la commande.
    const [invoice] = await db
      .update(supplierInvoices)
      .set({ purchaseOrderId: order.id })
      .where(eq(supplierInvoices.id, created.id))
      .returning();
    invoices.push(invoice);
  }
  return { orderId: order.id as number, invoices };
}

async function orderState(orderId: number) {
  const [row] = await db
    .select({ status: purchaseOrders.status, notes: purchaseOrders.notes })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId));
  return { status: row.status, notes: row.notes, traces: (row.notes ?? "").match(/\[TRACE_PO\]/g)?.length ?? 0 };
}

/** Attend que `count` sessions soient bloquées sur un verrou de `purchase_orders` (sans minuterie aveugle). */
async function waitForOrderLockWaiters(count: number, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%purchase_orders%'`);
    if (Number((result.rows[0] as { n: number }).n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Les ${count} clôtures n'ont pas atteint le verrou de la commande.`);
}

describe("clôture automatique de commande après règlement complet", { timeout: 60000 }, () => {
  it("témoin : commande livrée, factures soldées, la commande est clôturée avec une trace", async () => {
    const { orderId, invoices } = await orderWithInvoices("delivered", ["paid", "paid"]);
    await autoClose(invoices[1], actorId);

    const after = await orderState(orderId);
    expect(after.status).toBe("completed");
    expect(after.traces).toBe(1);
    expect(after.notes).toMatch(new RegExp(`^${NOTES}\\n\\[TRACE_PO\\] .* \\| delivered -> completed \\| .* \\| invoiceId=${invoices[1].id}$`));
  });

  it("deux clôtures simultanées et une note ajoutée entre-temps : une transition, une trace, rien de perdu", async () => {
    const { orderId, invoices } = await orderWithInvoices("delivered", ["paid", "paid"]);
    const added = `${NOTES}\nRéserve levée par le magasin.`;

    let closures: Promise<void>[] = [];
    await db.transaction(async (tx) => {
      // Le verrou tenu ici aligne les deux clôtures sur la même commande avant qu'aucune n'écrive,
      // pendant qu'une autre écriture modifie les notes. Une clôture qui a lu les notes hors verrou
      // efface cette note ; celle qui les relit sous verrou la conserve.
      await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
      await tx.update(purchaseOrders).set({ notes: added }).where(eq(purchaseOrders.id, orderId));
      closures = invoices.map((invoice) => autoClose(invoice, actorId));
      await waitForOrderLockWaiters(2);
    });
    await Promise.all(closures);

    const after = await orderState(orderId);
    expect(after.status).toBe("completed");
    expect(after.traces).toBe(1);
    expect(after.notes?.startsWith(`${added}\n[TRACE_PO] `), after.notes ?? "").toBe(true);
  });

  it("une facture liée non soldée : la commande reste livrée, notes inchangées", async () => {
    const { orderId, invoices } = await orderWithInvoices("delivered", ["paid", "approved"]);
    await autoClose(invoices[0], actorId);
    expect(await orderState(orderId)).toEqual({ status: "delivered", notes: NOTES, traces: 0 });
  });

  it("commande déjà clôturée ou annulée : aucune écriture", async () => {
    for (const status of ["completed", "cancelled"]) {
      const { orderId, invoices } = await orderWithInvoices(status, ["paid"]);
      await autoClose(invoices[0], actorId);
      expect(await orderState(orderId)).toEqual({ status, notes: NOTES, traces: 0 });
    }
  });
});
