import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrderItemsService } from "../../server/services/work-order-items-service";
import { workOrderItems, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";
import { pidOf, waitForWaitersOn } from "../support/lock-waiters";

/**
 * Deux mises à jour concurrentes d'une ligne de travail : la seconde part de l'état écrit par
 * la première (l'heure de début n'est pas réécrite).
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

describe("mises à jour concurrentes d'une ligne de travail", { timeout: 60000 }, () => {
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
