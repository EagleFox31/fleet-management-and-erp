import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { statusHistory, vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * Un véhicule hors service (décision manuelle) le reste quand un OT est créé ou rouvert :
 * `setVehicleToMaintenance` n'immobilise qu'un véhicule en service, comme le trigger
 * `trg_work_orders_hold_vehicle`. Aucune ligne d'historique n'est ajoutée.
 */
const ids = createIdBag();
const workOrderIds: number[] = [];

const statusOf = async (vehicleId: number) =>
  (await db.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, vehicleId)))[0].status;
const historyCount = async (vehicleId: number) =>
  (await db.select().from(statusHistory).where(eq(statusHistory.vehicleId, vehicleId))).length;

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  if (ids.vehicleIds.length > 0) await db.delete(statusHistory).where(inArray(statusHistory.vehicleId, ids.vehicleIds));
  await cleanupCreated(ids);
}, 120000);

describe("statut véhicule : le hors service est préservé", { timeout: 120000 }, () => {
  it("créer un OT sur un véhicule hors service ne le passe pas en maintenance", async () => {
    const v = await createTestVehicle({ status: "out_of_service" });
    ids.vehicleIds.push(v.id);
    const wo = await storage.createWorkOrder({ vehicleId: v.id, title: "TEST hors service", status: "pending" } as any);
    workOrderIds.push(wo.id);
    expect(await statusOf(v.id)).toBe("out_of_service");
    expect(await historyCount(v.id)).toBe(0);
  });

  it("rouvrir un OT sur un véhicule hors service ne le passe pas en maintenance", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const wo = await storage.createWorkOrder({ vehicleId: v.id, title: "TEST réouverture", status: "pending" } as any);
    workOrderIds.push(wo.id);
    await storage.updateWorkOrder(wo.id, { status: "cancelled" });
    await db.update(vehicles).set({ status: "out_of_service" }).where(eq(vehicles.id, v.id));
    const before = await historyCount(v.id);
    await storage.updateWorkOrder(wo.id, { status: "in_progress" });
    expect(await statusOf(v.id)).toBe("out_of_service");
    expect(await historyCount(v.id)).toBe(before);
  });

  it("un véhicule en service est toujours immobilisé à la création d'un OT", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const wo = await storage.createWorkOrder({ vehicleId: v.id, title: "TEST immobilisation", status: "pending" } as any);
    workOrderIds.push(wo.id);
    expect(await statusOf(v.id)).toBe("maintenance");
  });
});
