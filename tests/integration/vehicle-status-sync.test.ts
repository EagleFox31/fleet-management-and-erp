import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { statusHistory, vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { moveWorkOrderTo } from "../support/work-order-status";
import { createTestVehicle } from "../support/factories";

/**
 * Niveau I, VEH4 : le statut du véhicule suit l'ouverture et la clôture des ordres de travail,
 * et chaque changement est tracé dans `status_history`.
 * - ouvrir un OT immobilise le véhicule ; en clôturer un alors qu'un autre reste ouvert ne le libère pas ;
 * - la clôture du dernier OT le remet en service ; la rejouer n'ajoute aucune ligne d'historique ;
 * - un OT annulé ne laisse pas le véhicule immobilisé (trigger en base, quel que soit l'appelant) ;
 * - un véhicule hors service ne repasse jamais en service par ce biais.
 */

const ids = createIdBag();
const workOrderIds: number[] = [];

async function newVehicle(status: "operational" | "maintenance" | "out_of_service" = "operational") {
  const v = await createTestVehicle({ status });
  ids.vehicleIds.push(v.id);
  return v.id;
}

async function openWorkOrder(vehicleId: number, status: "pending" | "in_progress" = "pending") {
  const wo = await storage.createWorkOrder({ vehicleId, title: "TEST sync statut", status } as any);
  workOrderIds.push(wo.id);
  return wo.id;
}

const statusOf = async (vehicleId: number) =>
  (await db.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, vehicleId)))[0].status;
const historyOf = async (vehicleId: number) =>
  (await db.select().from(statusHistory).where(eq(statusHistory.vehicleId, vehicleId)).orderBy(asc(statusHistory.id))).map((h) => h.status);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  if (ids.vehicleIds.length > 0) await db.delete(statusHistory).where(inArray(statusHistory.vehicleId, ids.vehicleIds));
  await cleanupCreated(ids);
}, 120000);

describe("VEH4 : statut véhicule et ordres de travail", { timeout: 120000 }, () => {
  it("ouvrir un OT immobilise le véhicule, le clôturer le remet en service, les deux tracés", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    expect(await statusOf(vehicleId)).toBe("maintenance");
    expect(await historyOf(vehicleId)).toEqual(["maintenance"]);

    await moveWorkOrderTo(woId, "completed");
    expect(await statusOf(vehicleId)).toBe("operational");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });

  it("passer un OT en cours garde le véhicule en maintenance sans nouvelle ligne d'historique", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await moveWorkOrderTo(woId, "in_progress");
    expect(await statusOf(vehicleId)).toBe("maintenance");
    expect(await historyOf(vehicleId)).toEqual(["maintenance"]);
  });

  it("deux OT ouverts : clôturer le premier ne libère pas le véhicule, clôturer le second oui", async () => {
    const vehicleId = await newVehicle();
    const first = await openWorkOrder(vehicleId);
    const second = await openWorkOrder(vehicleId);
    await moveWorkOrderTo(first, "completed");
    expect(await statusOf(vehicleId)).toBe("maintenance");
    await moveWorkOrderTo(second, "completed");
    expect(await statusOf(vehicleId)).toBe("operational");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });

  it("clôturer deux fois le même OT n'ajoute pas de ligne d'historique", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await moveWorkOrderTo(woId, "completed");
    await moveWorkOrderTo(woId, "completed");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });

  it("rouvrir un OT clôturé immobilise de nouveau le véhicule", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await moveWorkOrderTo(woId, "completed");
    await moveWorkOrderTo(woId, "in_progress");
    expect(await statusOf(vehicleId)).toBe("maintenance");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational", "maintenance"]);
  });

  it("un OT créé directement clôturé ne touche pas le véhicule", async () => {
    const vehicleId = await newVehicle();
    const wo = await storage.createWorkOrder({ vehicleId, title: "TEST déjà clos", status: "completed" } as any);
    workOrderIds.push(wo.id);
    expect(await statusOf(vehicleId)).toBe("operational");
    expect(await historyOf(vehicleId)).toEqual([]);
  });

  describe("annulation (trigger trg_work_orders_release_vehicle)", () => {
    let vehicleId: number;
    let woId: number;
    beforeAll(async () => {
      vehicleId = await newVehicle();
      woId = await openWorkOrder(vehicleId);
    });

    it("annuler le dernier OT ouvert remet le véhicule en service", async () => {
      await moveWorkOrderTo(woId, "cancelled");
      expect(await statusOf(vehicleId)).toBe("operational");
      expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
    });
  });

  it("annuler un OT alors qu'un autre reste ouvert garde le véhicule en maintenance", async () => {
    const vehicleId = await newVehicle();
    const first = await openWorkOrder(vehicleId);
    await openWorkOrder(vehicleId, "in_progress");
    await moveWorkOrderTo(first, "cancelled");
    expect(await statusOf(vehicleId)).toBe("maintenance");
    expect(await historyOf(vehicleId)).toEqual(["maintenance"]);
  });

  it("clôture hors storage (UPDATE direct, comme le service technicien) : le véhicule est libéré quand même", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId, "in_progress");
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, woId));
    expect(await statusOf(vehicleId)).toBe("operational");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });

  it("un véhicule passé hors service n'est pas remis en service par l'annulation", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await db.update(vehicles).set({ status: "out_of_service" }).where(eq(vehicles.id, vehicleId));
    await moveWorkOrderTo(woId, "cancelled");
    expect(await statusOf(vehicleId)).toBe("out_of_service");
    expect(await historyOf(vehicleId)).toEqual(["maintenance"]);
  });

  it("un véhicule passé hors service n'est pas remis en service par la clôture completed (storage)", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await db.update(vehicles).set({ status: "out_of_service" }).where(eq(vehicles.id, vehicleId));
    await moveWorkOrderTo(woId, "completed");
    expect(await statusOf(vehicleId)).toBe("out_of_service");
    expect(await historyOf(vehicleId)).toEqual(["maintenance"]);
  });

  it("réouverture hors storage (UPDATE direct, comme le refus qualité) : le véhicule repasse en maintenance", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId, "in_progress");
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, woId));
    expect(await statusOf(vehicleId)).toBe("operational");
    await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, woId));
    expect(await statusOf(vehicleId)).toBe("maintenance");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational", "maintenance"]);
    // Rejouer la même réouverture (in_progress -> in_progress) ne touche à rien.
    await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, woId));
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational", "maintenance"]);
  });

  it("réouverture d'un OT sur un véhicule hors service : le véhicule reste hors service", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId, "in_progress");
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, woId));
    await db.update(vehicles).set({ status: "out_of_service" }).where(eq(vehicles.id, vehicleId));
    await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, woId));
    expect(await statusOf(vehicleId)).toBe("out_of_service");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });

  it("supprimer le dernier OT ouvert remet le véhicule en service", async () => {
    const vehicleId = await newVehicle();
    const woId = await openWorkOrder(vehicleId);
    await storage.deleteWorkOrder(woId);
    expect(await statusOf(vehicleId)).toBe("operational");
    expect(await historyOf(vehicleId)).toEqual(["maintenance", "operational"]);
  });
});
