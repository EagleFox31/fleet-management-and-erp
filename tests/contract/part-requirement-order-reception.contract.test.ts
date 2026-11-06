import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { ORDER_LINKED_RECEPTION_ERROR } from "../../server/services/part-requirements-service";
import { REQUIREMENT_NOT_ORDERABLE_ERROR } from "../../server/services/procurement-service";
import {
  alerts,
  partRequirements,
  parts,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
} from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { createTestPart, createTestSupplier } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * DÉCISION Q25 : une pièce commandée entre en stock une seule fois, à la livraison de la commande.
 * - Demande rattachée à une commande non annulée : `received` / `partially_received` par le PATCH
 *   de la demande → 409, ni stock ni statut ne bougent.
 * - Puis la livraison de la commande crédite le stock une seule fois et passe la demande à reçue.
 * - Commande annulée, ou demande sans commande : la réception directe reste permise.
 */

type Actor = "warehouse" | "technician";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let supplierId = 0;
const orderIds: number[] = [];
const requirementIds: number[] = [];

beforeAll(async () => {
  session = await startContractSession<Actor>({ warehouse: "warehouse", technician: "technician" });
  const supplier = await createTestSupplier();
  session.ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 60000);

afterAll(async () => {
  // Les commandes créées par HTTP s'ajoutent à celles posées en base.
  const created = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.supplierId, supplierId));
  orderIds.push(...created.map((o) => o.id).filter((id) => !orderIds.includes(id)));
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (session.ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, session.ids.partIds));
  }
  if (session.ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, session.ids.userIds));
  }
  await session.stop();
});

/** Demande « commandée » de 2 pièces (stock initial 5), rattachée ou non à une commande au statut voulu. */
async function orderedRequirement(orderStatus?: string, requirementStatus: "ordered" | "received" = "ordered") {
  const part = await createTestPart({ quantity: 5, unitPrice: "1000.00" });
  session.ids.partIds.push(part.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId: part.id, quantityNeeded: 2, reason: "TEST Q25", status: requirementStatus, requestedBy: session.userId("technician") })
    .returning();
  requirementIds.push(requirement.id);
  let orderId: number | null = null;
  if (orderStatus) {
    const [order] = await db
      .insert(purchaseOrders)
      .values({
        orderNumber: uniqueTestToken("po"),
        supplierId,
        orderDate: "2026-11-06",
        status: orderStatus,
        totalAmountHT: "2000.00",
        vatAmount: "0",
        totalAmountTTC: "2000.00",
      } as any)
      .returning();
    orderIds.push(order.id);
    orderId = order.id;
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: order.id,
      partId: part.id,
      partRequirementId: requirement.id,
      quantityOrdered: 2,
      unitPrice: "1000.00",
      totalPrice: "2000.00",
    });
  }
  return { requirementId: requirement.id, partId: part.id, orderId };
}

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: row.quantity, movements: movements.length };
}

async function statusOf(requirementId: number) {
  const [row] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, requirementId));
  return row.status;
}

const receive = (requirementId: number, status = "received", body: Record<string, unknown> = {}) =>
  session.call("PATCH", `/api/part-requirements/${requirementId}`, { actor: "warehouse", body: { status, ...body } });

describe("Q25 réception d'une pièce commandée", { timeout: 120000 }, () => {
  it.each(["received", "partially_received"])("commande en cours : %s par la demande → 409, rien ne bouge", async (status) => {
    const { requirementId, partId } = await orderedRequirement("confirmed");

    const res = await receive(requirementId, status, status === "partially_received" ? { quantityNeeded: 1 } : {});

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(ORDER_LINKED_RECEPTION_ERROR);
    expect(await statusOf(requirementId)).toBe("ordered");
    expect(await stockOf(partId)).toEqual({ quantity: 5, movements: 0 });
  });

  it("réception directe refusée puis livraison de la commande : stock crédité une seule fois", async () => {
    const { requirementId, partId, orderId } = await orderedRequirement("confirmed");

    const direct = await receive(requirementId);
    const delivered = await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, {
      actor: "warehouse",
      body: { status: "delivered", deliveryCode: "TEST-Q25" },
    });

    // Assiette unique : 5 + 2, un seul mouvement (sans la règle : 9, deux mouvements).
    expect(await stockOf(partId)).toEqual({ quantity: 7, movements: 1 });
    expect(direct.status).toBe(409);
    expect(delivered.status).toBe(200);
    expect(await statusOf(requirementId)).toBe("received");

    // Une seconde réception par la demande, déjà reçue, est sans transition : elle ne recrédite pas.
    await receive(requirementId);
    expect(await stockOf(partId)).toEqual({ quantity: 7, movements: 1 });
  });

  it("commande annulée : la réception directe reste permise", async () => {
    const { requirementId, partId } = await orderedRequirement("cancelled");

    const res = await receive(requirementId);

    expect(res.status).toBe(200);
    expect(await statusOf(requirementId)).toBe("received");
    expect(await stockOf(partId)).toEqual({ quantity: 7, movements: 1 });
  });

  it("demande sans commande : la réception directe reste permise", async () => {
    const { requirementId, partId } = await orderedRequirement();

    const res = await receive(requirementId);

    expect(res.status).toBe(200);
    expect(await stockOf(partId)).toEqual({ quantity: 7, movements: 1 });
  });

  it("demande déjà reçue : la recommander est refusée (409), aucune commande, statut inchangé", async () => {
    const { requirementId } = await orderedRequirement(undefined, "received");
    const linesBefore = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.partRequirementId, requirementId));

    const res = await session.call("POST", "/api/purchase-orders", {
      actor: "warehouse",
      body: { supplierId, requirementIds: [requirementId] },
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(REQUIREMENT_NOT_ORDERABLE_ERROR);
    expect(await statusOf(requirementId)).toBe("received");
    const linesAfter = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.partRequirementId, requirementId));
    expect(linesAfter).toHaveLength(linesBefore.length);
  });
});
