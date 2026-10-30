import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { procurementService } from "../../server/services/procurement-service";
import {
  partRequirements,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
} from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestSupplier, createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * PRT6, niveau I : l'entrée en stock d'une demande de pièce est attribuée à
 * celui qui réceptionne la commande fournisseur, pas au demandeur. La voie
 * PATCH de la demande est couverte au niveau C (`part-requirements-chain`).
 */

const ids = createIdBag();
const orderIds: number[] = [];
const requirementIds: number[] = [];

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

describe("entrée en stock par commande fournisseur : receivedBy (PRT6)", { timeout: 60000 }, () => {
  it("réception partielle puis complète : chaque étape porte le réceptionnaire", async () => {
    const [technician, warehouse, admin] = await Promise.all(
      (["technician", "warehouse", "admin"] as const).map((role) => createTestUser({ role })),
    );
    ids.userIds.push(technician.id, warehouse.id, admin.id);
    const part = await createTestPart({ quantity: 0 });
    ids.partIds.push(part.id);
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);

    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId: part.id, quantityNeeded: 2, reason: "TEST PRT6", status: "ordered", requestedBy: technician.id })
      .returning();
    requirementIds.push(requirement.id);

    const [order] = await db
      .insert(purchaseOrders)
      .values({
        orderNumber: uniqueTestToken("po"),
        supplierId: supplier.id,
        orderDate: "2026-10-30",
        status: "confirmed",
      })
      .returning();
    orderIds.push(order.id);
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: order.id,
      partRequirementId: requirement.id,
      partId: part.id,
      quantityOrdered: 2,
      unitPrice: "1000.00",
      totalPrice: "2000.00",
    });

    const receivedByOf = async () =>
      (await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id)))[0];

    await procurementService.updateOrderStatus(order.id, "partial", warehouse.id);
    expect(await receivedByOf()).toMatchObject({ status: "partially_received", receivedBy: warehouse.id });

    await procurementService.updateOrderStatus(order.id, "delivered", admin.id);
    expect(await receivedByOf()).toMatchObject({ status: "received", receivedBy: admin.id });
  });
});
