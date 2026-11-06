import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { isAppError } from "../../server/lib/app-error";
import {
  transitionWorkOrderStatus,
  WORK_ORDER_ASSIGNMENT_CHANGED_ERROR,
  WORK_ORDER_STATUS_CHANGED_ERROR,
} from "../../server/services/work-order-status-transition";
import { storage, WORK_ORDER_STATUS_VIA_TRANSITION_ERROR } from "../../server/storage";
import { vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

/**
 * `transitionWorkOrderStatus` : seule écriture dédiée du statut d'un OT. La règle de
 * transition est appliquée par la fonction elle-même, même appelée directement, et
 * l'écriture est un compare-and-set sur le statut lu.
 */

const ids = createIdBag();
const workOrderIds: number[] = [];

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
});

async function seed(status: (typeof workOrders.$inferInsert)["status"]) {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  await db.update(vehicles).set({ status: "operational" }).where(eq(vehicles.id, vehicle.id));
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST transition OT", status })
    .returning();
  workOrderIds.push(workOrder.id);
  return { workOrderId: workOrder.id, vehicleId: vehicle.id };
}

const statusOf = async (id: number) =>
  (await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, id)))[0].status;

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(isAppError(error), String(error)).toBe(true);
  return error as { status: number; message: string };
}

describe("transitionWorkOrderStatus", { timeout: 120000 }, () => {
  it.each([
    ["completed", "in_progress", "contrôle qualité"],
    ["cancelled", "awaiting_parts", "ne peut pas être rouvert"],
    ["pending", "completed", "n'est pas possible"],
  ] as const)("transition interdite %s -> %s : 409 lisible, rien n'est écrit", async (from, to, wording) => {
    const { workOrderId } = await seed(from);
    const error = await refusal(transitionWorkOrderStatus({ workOrderId, from, to }));
    expect(error.status).toBe(409);
    expect(error.message).toContain(wording);
    expect(error.message).not.toMatch(/select|update|stack|sql/i);
    expect(await statusOf(workOrderId)).toBe(from);
  });

  it("statut lu périmé : 409 lisible, le statut concurrent est conservé", async () => {
    const { workOrderId } = await seed("cancelled");
    const error = await refusal(transitionWorkOrderStatus({ workOrderId, from: "pending", to: "awaiting_parts" }));
    expect(error.status).toBe(409);
    expect(error.message).toBe(WORK_ORDER_STATUS_CHANGED_ERROR);
    expect(await statusOf(workOrderId)).toBe("cancelled");
  });

  it("statut lu périmé en mode skip : null, rien n'est écrit", async () => {
    const { workOrderId } = await seed("cancelled");
    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: "awaiting_parts",
      to: "in_progress",
      onStale: "skip",
    });
    expect(result).toBeNull();
    expect(await statusOf(workOrderId)).toBe("cancelled");
  });

  it("transition permise : statut et auteur écrits, véhicule en maintenance, retour enrichi", async () => {
    const user = await createTestUser({ role: "workshop_manager" });
    ids.userIds.push(user.id);
    const { workOrderId, vehicleId } = await seed("pending");
    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: "pending",
      to: "in_progress",
      updatedBy: user.id,
    });
    expect(result).toMatchObject({ id: workOrderId, status: "in_progress", updatedBy: user.id });
    const [vehicle] = await db.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(vehicle.status).toBe("maintenance");
  });

  it("le rôle passé est appliqué : un technicien n'annule pas (403), rien n'est écrit", async () => {
    const { workOrderId } = await seed("in_progress");
    const error = await refusal(
      transitionWorkOrderStatus({ workOrderId, from: "in_progress", to: "cancelled", role: "technician" }),
    );
    expect(error.status).toBe(403);
    expect(await statusOf(workOrderId)).toBe("in_progress");
  });

  it("champs écrits sous le même compare-and-set ; un `status` glissé dans les champs est ignoré", async () => {
    const { workOrderId } = await seed("pending");
    const result = await transitionWorkOrderStatus({
      workOrderId,
      from: "pending",
      to: "in_progress",
      fields: { title: "TEST titre avec statut", status: "cancelled" } as never,
    });
    expect(result).toMatchObject({ status: "in_progress", title: "TEST titre avec statut" });

    const stale = await seed("cancelled");
    await refusal(
      transitionWorkOrderStatus({ workOrderId: stale.workOrderId, from: "pending", to: "in_progress", fields: { title: "TEST trop tard" } }),
    );
    const [row] = await db.select({ title: workOrders.title }).from(workOrders).where(eq(workOrders.id, stale.workOrderId));
    expect(row.title).toBe("TEST transition OT");
  });

  it("OT réassigné, statut inchangé : 409 qui parle de réassignation, pas de statut", async () => {
    const [mine, other] = [await createTestUser({ role: "technician" }), await createTestUser({ role: "technician" })];
    ids.userIds.push(mine.id, other.id);
    const { workOrderId } = await seed("in_progress");
    await db.update(workOrders).set({ technicianId: other.id }).where(eq(workOrders.id, workOrderId));

    const error = await refusal(
      transitionWorkOrderStatus({ workOrderId, from: "in_progress", to: "completed", technicianId: mine.id }),
    );
    expect(error.status).toBe(409);
    expect(error.message).toBe(WORK_ORDER_ASSIGNMENT_CHANGED_ERROR);

    // Statut aussi changé : c'est le statut qui est annoncé.
    await db.update(workOrders).set({ status: "cancelled" }).where(eq(workOrders.id, workOrderId));
    const both = await refusal(
      transitionWorkOrderStatus({ workOrderId, from: "in_progress", to: "completed", technicianId: mine.id }),
    );
    expect(both.message).toBe(WORK_ORDER_STATUS_CHANGED_ERROR);
  });
});

describe("storage.updateWorkOrder", { timeout: 120000 }, () => {
  it("refuse le statut à l'exécution, sans rien écrire", async () => {
    const { workOrderId } = await seed("pending");
    const error = await storage
      .updateWorkOrder(workOrderId, { status: "cancelled", title: "TEST jamais écrit" } as never)
      .then(() => null, (e: Error) => e);
    expect(error?.message).toBe(WORK_ORDER_STATUS_VIA_TRANSITION_ERROR);
    const [row] = await db
      .select({ status: workOrders.status, title: workOrders.title })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    expect(row).toEqual({ status: "pending", title: "TEST transition OT" });
  });

  it("écrit les autres champs sans toucher au statut", async () => {
    const { workOrderId } = await seed("in_progress");
    const result = await storage.updateWorkOrder(workOrderId, { title: "TEST titre seul" });
    expect(result).toMatchObject({ status: "in_progress", title: "TEST titre seul" });
  });
});
