import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  technicianWorkOrdersService,
  WORK_ORDER_STATUS_CHANGED_ERROR,
} from "../../server/services/technician-work-orders-service";
import { workOrderItemsService } from "../../server/services/work-order-items-service";
import { workOrderItems, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";
import { pidOf, waitForWaitersOn } from "../support/lock-waiters";

/**
 * Transitions concurrentes sur un ordre de travail et ses lignes de travail.
 * - Prise en charge par le technicien pendant une clôture : 409, l'ordre reste clôturé.
 * - Deux mises à jour d'une ligne : la seconde part de l'état écrit par la première
 *   (l'heure de début n'est pas réécrite).
 */

const ids = createIdBag();
const woIds: number[] = [];
let technicianId = 0;
let vehicleId = 0;

beforeAll(async () => {
  const technician = await createTestUser({ role: "technician" });
  ids.userIds.push(technician.id);
  technicianId = technician.id;
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
});

afterAll(async () => {
  if (woIds.length > 0) {
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds));
    await db.delete(workOrders).where(inArray(workOrders.id, woIds));
  }
  await cleanupCreated(ids);
});

async function pendingWorkOrder() {
  const [wo] = await db
    .insert(workOrders)
    .values({ vehicleId, technicianId, title: "TEST CAS OT", status: "pending" })
    .returning();
  woIds.push(wo.id);
  return wo.id;
}

describe("transitions concurrentes d'un ordre de travail", { timeout: 60000 }, () => {
  it("prise en charge pendant une clôture : 409, l'ordre reste clôturé", async () => {
    const workOrderId = await pendingWorkOrder();

    let taking: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      // La clôture est écrite sans être validée : la prise en charge lit « en attente »,
      // puis attend le verrou de l'ordre.
      await tx.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, workOrderId));
      taking = technicianWorkOrdersService.takeWorkOrder(workOrderId, technicianId);
      taking.catch(() => undefined);
      await waitForWaitersOn(await pidOf(tx), 1);
    });

    await expect(taking).rejects.toMatchObject({ status: 409, message: WORK_ORDER_STATUS_CHANGED_ERROR });
    const [after] = await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, workOrderId));
    expect(after.status).toBe("completed");
  });

  it("deux mises à jour d'une ligne : l'heure de début écrite par la première est conservée", async () => {
    const workOrderId = await pendingWorkOrder();
    const [item] = await db
      .insert(workOrderItems)
      .values({ workOrderId, customLabel: "TEST CAS ligne", status: "pending" })
      .returning();
    const startedAt = new Date("2026-11-01T08:00:00.000Z");

    let closing: ReturnType<typeof workOrderItemsService.updateItem> | undefined;
    await db.transaction(async (tx) => {
      // Une première mise à jour démarre la ligne, sans être validée : la seconde la termine.
      await tx.update(workOrderItems).set({ status: "in_progress", startedAt }).where(eq(workOrderItems.id, item.id));
      closing = workOrderItemsService.updateItem(item.id, { status: "done" });
      await waitForWaitersOn(await pidOf(tx), 1);
    });

    expect(await closing!).toMatchObject({ success: true });
    const [after] = await db.select().from(workOrderItems).where(eq(workOrderItems.id, item.id));
    expect(after.status).toBe("done");
    expect(after.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(after.completedAt).not.toBeNull();
  });
});
