import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, statusHistory, vehicles, workOrders } from "../../shared/schema";
import { preventiveMaintenanceService } from "../../server/services/preventive-maintenance-service";
import { runPreventiveDateCheck } from "../../server/jobs/preventive-date-check";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * V5a : le contrôle par date tourne en tâche de fond, plusieurs fois par jour. L'échéance portée par
 * le véhicule (`nextMaintenanceDate`) n'avance pas à la clôture de l'OT : le rejeu ne doit donc rien
 * créer tant qu'elle n'a pas changé, quel que soit l'état de l'OT (l'ancien filtre ne portait que sur
 * « en attente » : un OT démarré ou clos était dupliqué à chaque passage).
 */
const ids = createIdBag();

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, ids.vehicleIds));
    await db.delete(statusHistory).where(inArray(statusHistory.vehicleId, ids.vehicleIds));
  }
  await cleanupCreated(ids);
});

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function vehicleDueIn(days: number) {
  const vehicle = await createTestVehicle({ mileage: 0 });
  ids.vehicleIds.push(vehicle.id);
  await db.update(vehicles).set({ nextMaintenanceDate: inDays(days) }).where(eq(vehicles.id, vehicle.id));
  return vehicle;
}

const passOn = (vehicleId: number) =>
  runPreventiveDateCheck({ check: () => preventiveMaintenanceService.checkDateBasedMaintenance(vehicleId) });

const otsOf = (vehicleId: number) =>
  db.select({ id: workOrders.id, status: workOrders.status }).from(workOrders).where(eq(workOrders.vehicleId, vehicleId));

describe("V5a : échéance du véhicule rejouée par la tâche de fond", { timeout: 120000 }, () => {
  it("OT démarré, en attente de pièces puis clôturé : le rejeu ne crée jamais de second OT", async () => {
    const vehicle = await vehicleDueIn(10);
    expect(await passOn(vehicle.id)).toBe(1);
    expect(await passOn(vehicle.id)).toBe(0);
    for (const status of ["in_progress", "awaiting_parts", "completed"] as const) {
      await db.update(workOrders).set({ status }).where(eq(workOrders.vehicleId, vehicle.id));
      expect(await passOn(vehicle.id), `statut ${status}`).toBe(0);
      expect(await otsOf(vehicle.id)).toHaveLength(1);
    }
  });

  it("OT clos puis échéance repoussée du véhicule : un nouvel OT, une seule fois", async () => {
    const vehicle = await vehicleDueIn(10);
    expect(await passOn(vehicle.id)).toBe(1);
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.vehicleId, vehicle.id));

    await db.update(vehicles).set({ nextMaintenanceDate: inDays(60) }).where(eq(vehicles.id, vehicle.id));
    expect(await passOn(vehicle.id), "échéance hors fenêtre").toBe(0);
    await db.update(vehicles).set({ nextMaintenanceDate: inDays(25) }).where(eq(vehicles.id, vehicle.id));
    expect(await passOn(vehicle.id), "dans la fenêtre, postérieure à l'OT clos").toBe(1);
    expect(await passOn(vehicle.id)).toBe(0);
    expect(await otsOf(vehicle.id)).toHaveLength(2);
  });

  it("OT annulé : l'échéance reste à traiter", async () => {
    const vehicle = await vehicleDueIn(10);
    expect(await passOn(vehicle.id)).toBe(1);
    await db.update(workOrders).set({ status: "cancelled" }).where(eq(workOrders.vehicleId, vehicle.id));
    expect(await passOn(vehicle.id)).toBe(1);
  });
});
