import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  partRequirements,
  parts,
  partsStockMovements,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
} from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestSupplier } from "../support/factories";

/**
 * Parcours P6 (docs/qa/PLAN_COUVERTURE_MODULES.md) : stock bas -> réapprovisionnement, une seule
 * pièce suivie de bout en bout par HTTP avec le rôle de chaque étape.
 *
 *   sortie du stock -> seuil atteint -> alerte de réappro -> commande fournisseur
 *   -> réception -> stock rétabli -> alerte levée
 *
 * Les maillons isolés existent déjà (`stock-alert-lifecycle` : alerte et levée par ajustement ;
 * `purchase-order-lifecycle` : statuts et réception). Ce fichier ne prouve que le chaînage :
 * l'alerte ne se lève pas avant la réception, la réception crédite exactement la quantité commandée,
 * une réception rejouée ne crédite pas deux fois.
 */

const ACTORS = { admin: "admin", warehouse: "warehouse", technician: "technician" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const orderIds: number[] = [];
const requirementIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let supplierId = 0;

async function alertFor(partId: number): Promise<{ quantity: number; minQuantity: number; shortage: number } | undefined> {
  const res = await session.call("GET", "/api/warehouse/reorder-alerts", { actor: "warehouse" });
  expect(res.status).toBe(200);
  return res.body.parts.find((p: any) => p.id === partId);
}

async function stockOf(partId: number): Promise<number> {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity ?? 0;
}

/** Demande de pièce approuvée pour la pièce : c'est elle que l'achat transforme en ligne de commande. */
async function approvedRequirement(partId: number, quantityNeeded: number): Promise<number> {
  const [row] = await db
    .insert(partRequirements)
    .values({
      partId,
      quantityNeeded,
      reason: "TEST P6 réappro",
      status: "approved",
      requestedBy: session.userIdOf("technician"),
    })
    .returning();
  requirementIds.push(row.id);
  return row.id;
}

const setStatus = (orderId: number, status: string, extra: Record<string, unknown> = {}) =>
  session.call("PATCH", `/api/purchase-orders/${orderId}/status`, { actor: "warehouse", body: { status, ...extra } });

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120000);

afterAll(async () => {
  try {
    if (orderIds.length > 0) {
      await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
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
  } finally {
    await session?.close();
  }
}, 120000);

describe("P6 : stock bas -> réapprovisionnement", { timeout: 180000 }, () => {
  it("sortie sous le seuil, alerte, commande, réception : stock rétabli, alerte levée, réception rejouée sans effet", async () => {
    // 1. Pièce au-dessus du seuil : pas d'alerte.
    const part = await createTestPart({ quantity: 8, minQuantity: 5 });
    ids.partIds.push(part.id);
    expect(await alertFor(part.id)).toBeUndefined();

    // 2. Sortie du stock par le magasinier (-5) : 3 <= seuil 5, la pièce entre dans la liste de réappro.
    const out = await session.call("POST", `/api/parts/${part.id}/update-stock`, {
      actor: "warehouse",
      body: { adjustment: -5, reason: "TEST P6 sortie" },
    });
    expect(out.status).toBe(200);
    expect(await stockOf(part.id)).toBe(3);
    expect(await alertFor(part.id)).toMatchObject({ quantity: 3, minQuantity: 5, shortage: 2 });

    // 3. Achats commande 10 unités à partir d'une demande approuvée : la commande naît en brouillon,
    //    la demande passe à « commandée », le stock n'a pas bougé.
    const requirementId = await approvedRequirement(part.id, 10);
    const created = await session.call("POST", "/api/purchase-orders", {
      actor: "admin",
      body: { supplierId, requirementIds: [requirementId] },
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as number;
    orderIds.push(orderId);
    expect(created.body.status).toBe("draft");
    expect(await stockOf(part.id)).toBe(3);

    // 4. Tant que rien n'est reçu, l'alerte reste, à chaque étape de la commande.
    expect((await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, { actor: "admin", body: { status: "sent" } })).status).toBe(200);
    expect(await alertFor(part.id)).toBeDefined();
    expect((await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, { actor: "admin", body: { status: "confirmed" } })).status).toBe(200);
    expect(await alertFor(part.id)).toBeDefined();
    expect(await stockOf(part.id)).toBe(3);

    // 5. Réception complète par le magasinier : +10 exactement, une entrée de stock à son nom.
    const delivered = await setStatus(orderId, "delivered", { deliveryCode: "TEST-P6-BL" });
    expect(delivered.status).toBe(200);
    expect(await stockOf(part.id)).toBe(13);
    const movements = await db.select().from(partsStockMovements).where(and(eq(partsStockMovements.partId, part.id), eq(partsStockMovements.movementType, "in")));
    expect(movements).toEqual([expect.objectContaining({ quantity: 10, createdBy: session.userIdOf("warehouse") })]);

    // 6. Alerte levée ; la demande est reçue.
    expect(await alertFor(part.id)).toBeUndefined();
    const [requirement] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirementId));
    expect(requirement.status).toBe("received");

    // 7. Rejouer la réception ne crédite rien de plus.
    const again = await setStatus(orderId, "delivered", { deliveryCode: "TEST-P6-BL" });
    expect(again.status).toBeLessThan(500);
    expect(await stockOf(part.id)).toBe(13);
  });

  it("réception refusée au technicien : la commande n'avance pas, le stock et l'alerte restent", async () => {
    const part = await createTestPart({ quantity: 2, minQuantity: 5 });
    ids.partIds.push(part.id);
    const requirementId = await approvedRequirement(part.id, 4);
    const created = await session.call("POST", "/api/purchase-orders", {
      actor: "admin",
      body: { supplierId, requirementIds: [requirementId] },
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as number;
    orderIds.push(orderId);
    for (const status of ["sent", "confirmed"]) {
      expect((await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, { actor: "admin", body: { status } })).status).toBe(200);
    }

    const denied = await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, {
      actor: "technician",
      body: { status: "delivered", deliveryCode: "TEST-P6-X" },
    });
    expect(denied.status).toBe(403);
    expect(await stockOf(part.id)).toBe(2);
    expect(await alertFor(part.id)).toMatchObject({ quantity: 2 });
    const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
    expect(order.status).toBe("confirmed");
  });

  it("réception insuffisante : l'alerte reste tant que le stock n'a pas dépassé le seuil", async () => {
    // 3 en stock, seuil 5, commande de 1 : 3 + 1 = 4 <= 5, la pièce reste à réapprovisionner.
    const part = await createTestPart({ quantity: 3, minQuantity: 5 });
    ids.partIds.push(part.id);
    const requirementId = await approvedRequirement(part.id, 1);
    const created = await session.call("POST", "/api/purchase-orders", {
      actor: "admin",
      body: { supplierId, requirementIds: [requirementId] },
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as number;
    orderIds.push(orderId);
    for (const status of ["sent", "confirmed"]) {
      expect((await session.call("PATCH", `/api/purchase-orders/${orderId}/status`, { actor: "admin", body: { status } })).status).toBe(200);
    }
    expect((await setStatus(orderId, "delivered", { deliveryCode: "TEST-P6-C" })).status).toBe(200);

    expect(await stockOf(part.id)).toBe(4);
    expect(await alertFor(part.id)).toMatchObject({ quantity: 4, shortage: 1 });
  });
});
