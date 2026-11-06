import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { procurementService } from "../../server/services/procurement-service";
import { parts, partsStockMovements, purchaseOrderLines, purchaseOrders, supplierInvoices } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestSupplierInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { pidOf, waitForWaitersOn } from "../support/lock-waiters";

/**
 * Transition manuelle de commande fournisseur (`updateOrderStatus`) : verrou, relecture, CAS.
 * - Deux réceptions simultanées : une seule transition, une seule entrée en stock, une seule trace.
 * - Clôture manuelle pendant qu'une facture liée repasse non soldée : la clôture attend, puis refuse.
 * - Témoin : clôture d'une commande livrée dont la facture est soldée.
 */

const ids = createIdBag();
const orderIds: number[] = [];
let supplierId = 0;
let actorId = 0;

beforeAll(async () => {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  actorId = user.id;
});

afterAll(async () => {
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

async function order(status: string, partId?: number) {
  const [row] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: "2026-11-06",
      status,
      // Totaux cohérents avec la ligne : la livraison crée la facture fournisseur, qui refuse un montant nul.
      totalAmountHT: "2000.00",
      totalAmountTTC: "2000.00",
    } as any)
    .returning();
  orderIds.push(row.id);
  if (partId) {
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: row.id,
      partId,
      quantityOrdered: 2,
      unitPrice: "1000.00",
      totalPrice: "2000.00",
    });
  }
  return row.id as number;
}

async function linkedInvoice(orderId: number, status: string) {
  const created = await createTestSupplierInvoice({ supplierId, status: status as any });
  ids.invoiceIds.push(created.id);
  // La fabrique ne transmet pas `purchaseOrderId` : rattachement explicite à la commande.
  await db.update(supplierInvoices).set({ purchaseOrderId: orderId }).where(eq(supplierInvoices.id, created.id));
  return created.id;
}

async function orderState(orderId: number) {
  const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  return { status: row.status, traces: (row.notes ?? "").match(/\[TRACE_PO\]/g)?.length ?? 0 };
}

describe("transition manuelle de commande : verrou et compare-and-set", { timeout: 60000 }, () => {
  it("deux réceptions simultanées : une transition, une entrée en stock, une trace", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const orderId = await order("confirmed", part.id);

    let receptions: Promise<unknown>[] = [];
    await db.transaction(async (tx) => {
      // Le verrou tenu ici aligne les deux réceptions sur la même commande avant qu'aucune n'écrive.
      await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
      receptions = [1, 2].map(() => procurementService.updateOrderStatus(orderId, "delivered", actorId));
      await waitForWaitersOn(await pidOf(tx), 2);
    });
    const results = await Promise.all(receptions);

    expect(results.map((r: any) => r.status)).toEqual(["delivered", "delivered"]);
    expect(await orderState(orderId)).toEqual({ status: "delivered", traces: 1 });
    const [stock] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(2);
    const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
    expect(movements).toHaveLength(1);
  });

  it("clôture pendant qu'une facture liée repasse non soldée : la clôture attend puis refuse", async () => {
    const orderId = await order("delivered");
    const invoiceId = await linkedInvoice(orderId, "paid");

    let closure: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      // Règlement annulé dans une transaction en cours : la clôture doit attendre son issue.
      await tx.update(supplierInvoices).set({ status: "approved" }).where(eq(supplierInvoices.id, invoiceId));
      closure = procurementService.updateOrderStatus(orderId, "completed", actorId).catch((error) => error);
      await waitForWaitersOn(await pidOf(tx), 1);
    });

    const outcome = (await closure) as { status?: number; message?: string };
    expect(outcome).toMatchObject({ status: 409 });
    expect(outcome.message).toMatch(/^Clôture impossible : facture\(s\) fournisseur non payée\(s\)/);
    expect(await orderState(orderId)).toEqual({ status: "delivered", traces: 0 });
  });

  it("témoin : commande livrée, facture soldée, la clôture manuelle aboutit avec une trace", async () => {
    const orderId = await order("delivered");
    await linkedInvoice(orderId, "paid");

    const closed = await procurementService.updateOrderStatus(orderId, "completed", actorId);

    expect(closed.status).toBe("completed");
    expect(await orderState(orderId)).toEqual({ status: "completed", traces: 1 });
    // Rejeu : statut déjà atteint, aucune écriture.
    await procurementService.updateOrderStatus(orderId, "completed", actorId);
    expect(await orderState(orderId)).toEqual({ status: "completed", traces: 1 });
  });
});
