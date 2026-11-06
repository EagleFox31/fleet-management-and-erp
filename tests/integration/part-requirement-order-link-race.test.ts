import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { ORDER_LINKED_RECEPTION_ERROR, partRequirementsService } from "../../server/services/part-requirements-service";
import { procurementService, REQUIREMENT_NOT_ORDERABLE_ERROR } from "../../server/services/procurement-service";
import { partRequirements, parts, partsStockMovements, purchaseOrderLines, purchaseOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { pidOf, waitForWaitersOn } from "../support/lock-waiters";

/**
 * DÉCISION Q25 sous concurrence : le lien demande ↔ commande est vérifié sous verrou.
 * - Réception directe pendant qu'une commande se rattache à la demande : refusée, stock intact.
 * - Création de commande pendant que la demande cesse d'être approuvée : refusée, aucune ligne.
 */

const ids = createIdBag();
const requirementIds: number[] = [];
let supplierId = 0;
let warehouseId = 0;

beforeAll(async () => {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
  const user = await createTestUser({ role: "warehouse" });
  ids.userIds.push(user.id);
  warehouseId = user.id;
});

afterAll(async () => {
  const orders = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.supplierId, supplierId));
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
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

async function requirementWithPart(status: "approved" | "ordered") {
  const part = await createTestPart({ quantity: 5, unitPrice: "1000.00" });
  ids.partIds.push(part.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({ partId: part.id, quantityNeeded: 2, reason: "TEST Q25 course", status, requestedBy: warehouseId })
    .returning();
  requirementIds.push(requirement.id);
  return { requirementId: requirement.id, partId: part.id };
}

async function stockOf(partId: number) {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: row.quantity, movements: movements.length };
}

describe("Q25 : lien demande-commande vérifié sous verrou", { timeout: 60000 }, () => {
  it("réception directe pendant le rattachement de la demande à une commande : 409, stock intact", async () => {
    const { requirementId, partId } = await requirementWithPart("ordered");
    const [order] = await db
      .insert(purchaseOrders)
      .values({ orderNumber: uniqueTestToken("po"), supplierId, orderDate: "2026-11-06", status: "confirmed", totalAmountHT: "2000.00", totalAmountTTC: "2000.00" } as any)
      .returning();

    let reception: ReturnType<typeof partRequirementsService.updatePartRequirement> | undefined;
    await db.transaction(async (tx) => {
      // La demande est verrouillée et la ligne qui la porte est écrite, sans être validée : la
      // réception lit « pas de commande », puis attend le verrou.
      await tx.select({ id: partRequirements.id }).from(partRequirements).where(eq(partRequirements.id, requirementId)).for("update");
      await tx.insert(purchaseOrderLines).values({ purchaseOrderId: order.id, partId, partRequirementId: requirementId, quantityOrdered: 2, unitPrice: "1000.00", totalPrice: "2000.00" });
      reception = partRequirementsService.updatePartRequirement(requirementId, { status: "received" }, "warehouse", warehouseId);
      await waitForWaitersOn(await pidOf(tx), 1);
    });

    const result = await reception!;
    expect(result).toMatchObject({ success: false, error: ORDER_LINKED_RECEPTION_ERROR, status: 409 });
    expect(await stockOf(partId)).toEqual({ quantity: 5, movements: 0 });
    const [after] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, requirementId));
    expect(after.status).toBe("ordered");
  });

  it("création de commande pendant que la demande cesse d'être approuvée : 409, aucune ligne", async () => {
    const { requirementId } = await requirementWithPart("approved");

    let creation: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // Une autre écriture fait passer la demande à « commandée », sans être validée : la création
      // lit « approuvée », puis attend le verrou de la demande.
      await tx.update(partRequirements).set({ status: "ordered" }).where(eq(partRequirements.id, requirementId));
      creation = procurementService.createPurchaseOrder({ supplierId, requirementIds: [requirementId], createdBy: warehouseId });
      creation.catch(() => undefined);
      await waitForWaitersOn(await pidOf(tx), 1);
    });

    await expect(creation).rejects.toMatchObject({ status: 409, message: REQUIREMENT_NOT_ORDERABLE_ERROR });
    const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.partRequirementId, requirementId));
    expect(lines).toHaveLength(0);
  });
});
