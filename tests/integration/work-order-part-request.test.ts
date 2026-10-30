import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { requestPartForWorkOrder } from "../../server/services/work-order-part-request";
import { partRequirements, parts, partsStockMovements, partsUsed, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle } from "../support/factories";

/**
 * « Demander la pièce » depuis un OT, niveau I : le serveur décide au clic.
 * Stock suffisant : sortie directe. Stock insuffisant : le disponible sort, le
 * manquant part en demande, l'OT passe en attente de pièces. Le stock ne
 * devient jamais négatif (l'ancienne voie laissait magasinier et admin forcer).
 */

const ids = createIdBag();
const workOrderIds: number[] = [];

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

async function setup(stock: number, workOrder: Partial<typeof workOrders.$inferInsert> = {}) {
  const technician = await createTestUser({ role: "technician" });
  ids.userIds.push(technician.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: stock, unitPrice: "2500.00" });
  ids.partIds.push(part.id);
  const [row] = await db
    .insert(workOrders)
    .values({
      vehicleId: vehicle.id,
      title: "TEST demande de pièce",
      status: "in_progress",
      technicianId: technician.id,
      ...workOrder,
    })
    .returning();
  workOrderIds.push(row.id);
  return { technician, part, workOrder: row, actor: { id: technician.id, role: "technician" } };
}

async function stateOf(workOrderId: number, partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  const lines = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrderId));
  const requirements = await db
    .select()
    .from(partRequirements)
    .where(eq(partRequirements.workOrderId, workOrderId));
  return { stock: part.quantity, status: workOrder.status, lines, requirements };
}

describe("requestPartForWorkOrder", { timeout: 120000 }, () => {
  it("stock suffisant : sortie directe au prix catalogue, ni demande ni attente", async () => {
    const { part, workOrder, actor } = await setup(5);

    const result = await requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 3, actor });

    expect(result).toMatchObject({ issuedQuantity: 3, missingQuantity: 0, requirement: null, workOrderStatusChanged: false });
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(2);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0].quantity).toBe(3);
    expect(Number(state.lines[0].unitPrice)).toBe(2500);
    expect(state.requirements).toHaveLength(0);
    expect(state.status).toBe("in_progress");
  });

  it("stock partiel : le disponible sort, le manquant est demandé, l'OT attend", async () => {
    const { technician, part, workOrder, actor } = await setup(2);

    const result = await requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 5, actor });

    expect(result).toMatchObject({ issuedQuantity: 2, missingQuantity: 3, usedExistingRequirement: false, workOrderStatusChanged: true });
    expect(result.workOrder?.status).toBe("awaiting_parts");
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(0);
    expect(state.lines.map((l) => l.quantity)).toEqual([2]);
    expect(state.requirements).toHaveLength(1);
    expect(state.requirements[0]).toMatchObject({
      status: "pending",
      quantityNeeded: 3,
      partId: part.id,
      requestedBy: technician.id,
      vehicleId: workOrder.vehicleId,
    });
    expect(state.status).toBe("awaiting_parts");
  });

  it("stock épuisé : tout part en demande, rien ne sort", async () => {
    const { part, workOrder, actor } = await setup(0);

    const result = await requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 2, actor });

    expect(result).toMatchObject({ issuedQuantity: 0, missingQuantity: 2, partUsed: null });
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(0);
    expect(state.lines).toHaveLength(0);
    expect(state.requirements.map((r) => r.quantityNeeded)).toEqual([2]);
    expect(state.status).toBe("awaiting_parts");
  });

  it("une demande déjà en cours sur la même pièce est réutilisée, pas doublée", async () => {
    const { part, workOrder, actor } = await setup(0);

    const first = await requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 1, actor });
    const replay = await requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 1, actor });

    expect(replay.usedExistingRequirement).toBe(true);
    expect(replay.requirement?.id).toBe(first.requirement?.id);
    expect(replay.workOrderStatusChanged).toBe(false);
    expect(replay.message).toContain("déjà en cours");
    const state = await stateOf(workOrder.id, part.id);
    expect(state.requirements).toHaveLength(1);
  });

  it("des demandes simultanées ne sortent pas deux fois la même unité ni ne doublent la demande", async () => {
    const { part, workOrder, actor } = await setup(3);

    // Cinq appels plutôt que deux : la course dépend du timing réseau.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 1, actor }),
      ),
    );

    expect(results.reduce((sum, r) => sum + r.issuedQuantity, 0)).toBe(3);
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(0);
    expect(state.lines.reduce((sum, l) => sum + l.quantity, 0)).toBe(3);
    expect(state.requirements).toHaveLength(1);
    expect(state.status).toBe("awaiting_parts");
  });

  it("refuse un technicien sur l'OT d'un autre (403), sans toucher au stock", async () => {
    const { part, workOrder } = await setup(5);
    const other = await createTestUser({ role: "technician" });
    ids.userIds.push(other.id);

    await expect(
      requestPartForWorkOrder({
        workOrderId: workOrder.id,
        partId: part.id,
        quantity: 1,
        actor: { id: other.id, role: "technician" },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await stateOf(workOrder.id, part.id)).stock).toBe(5);
  });

  it("refuse un OT terminé (400), une quantité invalide (400), une pièce inconnue (404)", async () => {
    const { part, workOrder, actor } = await setup(5, { status: "completed" });

    await expect(
      requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 1, actor }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      requestPartForWorkOrder({ workOrderId: workOrder.id, partId: part.id, quantity: 0, actor }),
    ).rejects.toMatchObject({ status: 400 });

    const { workOrder: open, actor: openActor } = await setup(5);
    await expect(
      requestPartForWorkOrder({ workOrderId: open.id, partId: 2147483000, quantity: 1, actor: openActor }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await stateOf(workOrder.id, part.id)).stock).toBe(5);
  });
});
