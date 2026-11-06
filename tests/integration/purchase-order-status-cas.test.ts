import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { procurementService } from "../../server/services/procurement-service";
import { partRequirements, parts, partsStockMovements, purchaseOrderLines, purchaseOrders, supplierInvoices } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestSupplierInvoice, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { pidOf, waitForWaitersOn } from "../support/lock-waiters";

/**
 * Transition manuelle de commande fournisseur (`updateOrderStatus`) : verrou, relecture, CAS.
 * - Deux réceptions simultanées : une seule transition, une seule entrée en stock, une seule trace.
 * - Clôture manuelle pendant qu'une facture liée repasse non soldée : la clôture attend, puis refuse.
 * - Témoin : clôture d'une commande livrée dont la facture est soldée.
 * - Livraison pendant une réception de ligne : le crédit déjà fait est déduit, pas recrédité.
 * - Panne de l'entrée en stock : rien n'est validé, un nouvel essai refait tout.
 * - Livraison pendant le PATCH d'une demande liée : même ordre de verrous, pas d'interblocage.
 */

const ids = createIdBag();
const orderIds: number[] = [];
const requirementIds: number[] = [];
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
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function order(status: string, partId?: number, partRequirementId?: number) {
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
      partRequirementId,
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

async function lineOf(orderId: number) {
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, orderId));
  return line;
}

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: row.quantity, movements: movements.length };
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

  it("livraison pendant une réception de ligne en cours : le crédit de la ligne est déduit", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const orderId = await order("confirmed", part.id);
    const line = await lineOf(orderId);

    let delivery: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      // Réception d'une pièce sur la ligne, non encore validée : quantité reçue et stock à 1.
      await tx.update(purchaseOrderLines).set({ quantityReceived: 1, deliveryStatus: "partial" }).where(eq(purchaseOrderLines.id, line.id));
      await tx.update(parts).set({ quantity: 1 }).where(eq(parts.id, part.id));
      delivery = procurementService.updateOrderStatus(orderId, "delivered", actorId);
      await waitForWaitersOn(await pidOf(tx), 1);
    });
    await delivery;

    // 2 commandées : 1 par la ligne, 1 par la livraison. Sans verrou des lignes, la livraison en créditait 2.
    expect((await stockOf(part.id)).quantity).toBe(2);
    expect((await lineOf(orderId)).quantityReceived).toBe(2);
  });

  it("réception de ligne et livraison simultanées : le stock converge sur la quantité commandée", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const orderId = await order("confirmed", part.id);
    const line = await lineOf(orderId);

    let attempts: Promise<unknown>[] = [];
    await db.transaction(async (tx) => {
      // Le verrou de la commande aligne la réception de ligne et la livraison : chacune doit l'attendre.
      await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
      attempts = [
        procurementService.updateOrderLine(line.id, { quantityReceived: 1, deliveryStatus: "partial" }, actorId, orderId).catch((e) => e),
        procurementService.updateOrderStatus(orderId, "delivered", actorId),
      ];
      await waitForWaitersOn(await pidOf(tx), 2);
    });
    await Promise.all(attempts);

    expect(await stockOf(part.id)).toMatchObject({ quantity: 2 });
    expect((await lineOf(orderId)).quantityReceived).toBe(2);
    expect((await orderState(orderId)).status).toBe("delivered");
  });

  it("panne de l'entrée en stock : la commande n'est pas livrée, un nouvel essai crédite le stock", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const orderId = await order("confirmed", part.id);
    vi.spyOn(procurementService as any, "registerPartReception").mockRejectedValueOnce(new Error("panne injectée"));

    await expect(procurementService.updateOrderStatus(orderId, "delivered", actorId)).rejects.toThrow("panne injectée");

    expect(await orderState(orderId)).toEqual({ status: "confirmed", traces: 0 });
    expect((await lineOf(orderId)).quantityReceived ?? 0).toBe(0);
    expect(await stockOf(part.id)).toEqual({ quantity: 0, movements: 0 });

    await procurementService.updateOrderStatus(orderId, "delivered", actorId);
    expect(await orderState(orderId)).toEqual({ status: "delivered", traces: 1 });
    expect(await stockOf(part.id)).toEqual({ quantity: 2, movements: 1 });
  });

  it("panne de l'entrée en stock sur une ligne : la quantité reçue n'est pas enregistrée", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const orderId = await order("confirmed", part.id);
    const line = await lineOf(orderId);
    vi.spyOn(procurementService as any, "registerPartReception").mockRejectedValueOnce(new Error("panne injectée"));

    await expect(procurementService.updateOrderLine(line.id, { quantityReceived: 1 }, actorId, orderId)).rejects.toThrow("panne injectée");
    expect((await lineOf(orderId)).quantityReceived ?? 0).toBe(0);

    await procurementService.updateOrderLine(line.id, { quantityReceived: 1 }, actorId, orderId);
    expect((await lineOf(orderId)).quantityReceived).toBe(1);
    expect(await stockOf(part.id)).toEqual({ quantity: 1, movements: 1 });
  });

  it("livraison pendant le PATCH d'une demande liée : demande puis pièce des deux côtés, pas d'interblocage", async () => {
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId: part.id, quantityNeeded: 2, reason: "TEST CAS livraison", status: "ordered", requestedBy: actorId })
      .returning();
    requirementIds.push(requirement.id);
    const orderId = await order("confirmed", part.id, requirement.id);

    let delivery: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      // Ce que fait le PATCH d'une demande : verrou de la demande, puis incrément du stock.
      await tx.select({ id: partRequirements.id }).from(partRequirements).where(eq(partRequirements.id, requirement.id)).for("update");
      delivery = procurementService.updateOrderStatus(orderId, "delivered", actorId);
      await waitForWaitersOn(await pidOf(tx), 1);
      // Livraison bloquée sur la demande : si elle tenait déjà la pièce, cette écriture fermerait le cycle (40P01).
      await tx.update(parts).set({ quantity: 5 }).where(eq(parts.id, part.id));
    });
    await delivery;

    expect((await stockOf(part.id)).quantity).toBe(7);
    const [after] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(after.status).toBe("received");
  });
});
