import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { maintenanceSchedules, statusHistory, vehicles, workOrders } from "../../shared/schema";
import { preventiveMaintenanceService } from "../../server/services/preventive-maintenance-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * MNT2, déclenchement des maintenances préventives : par date (échéances du
 * véhicule, fenêtre de 30 jours) et par kilométrage (seuil d'un plan actif).
 * Toujours un `vehicleId` : sans lui le service parcourt tous les véhicules de
 * la base partagée.
 */

const ids = createIdBag();
const scheduleIds: number[] = [];

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, ids.vehicleIds));
    await db.delete(statusHistory).where(inArray(statusHistory.vehicleId, ids.vehicleIds));
  }
  await cleanupCreated(ids);
});

/** Date AAAA-MM-JJ à `days` jours d'aujourd'hui, en UTC comme les colonnes `date`. */
function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function vehicleWith(fields: Partial<typeof vehicles.$inferInsert> = {}, mileage = 0) {
  const vehicle = await createTestVehicle({ mileage });
  ids.vehicleIds.push(vehicle.id);
  if (Object.keys(fields).length > 0) await db.update(vehicles).set(fields).where(eq(vehicles.id, vehicle.id));
  return vehicle;
}

async function mileagePlan(vehicleId: number, scheduledMileage: number, frequencyValue: number, isActive = true) {
  const [schedule] = await db
    .insert(maintenanceSchedules)
    .values({
      vehicleId,
      title: uniqueTestToken("plan"),
      frequency: "mileage",
      frequencyValue,
      scheduledDate: inDays(400),
      scheduledMileage,
      isActive,
    })
    .returning();
  scheduleIds.push(schedule.id);
  return schedule;
}

const pendingFor = (scheduleId: number) =>
  db.select().from(workOrders).where(eq(workOrders.maintenanceScheduleId, scheduleId));

describe("MNT2 : déclenchement par date", { timeout: 120000 }, () => {
  it("une échéance de maintenance dans la fenêtre crée un OT préventif et immobilise le véhicule, une fois", async () => {
    const vehicle = await vehicleWith({ nextMaintenanceDate: inDays(10) });
    const first = await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id, "maintenance");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ vehicleId: vehicle.id, isPreventive: true, status: "pending" });

    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(after.status).toBe("maintenance");
    const history = await db.select().from(statusHistory).where(eq(statusHistory.vehicleId, vehicle.id));
    expect(history.length).toBeGreaterThan(0);

    // Rejeu : l'OT en attente de même titre bloque un doublon.
    const second = await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id, "maintenance");
    expect(second).toHaveLength(0);
    const all = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, vehicle.id));
    expect(all).toHaveLength(1);
  });

  it("borne de la fenêtre : J+30 déclenche, J+31, une date vide et une date lointaine non", async () => {
    const edge = await vehicleWith({ nextMaintenanceDate: inDays(30) });
    const beyond = await vehicleWith({ nextMaintenanceDate: inDays(31) });
    const far = await vehicleWith({ nextMaintenanceDate: inDays(200) });
    const empty = await vehicleWith();

    expect(await preventiveMaintenanceService.checkDateBasedMaintenance(edge.id, "maintenance")).toHaveLength(1);
    for (const vehicle of [beyond, far, empty]) {
      expect(await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id, "maintenance")).toHaveLength(0);
    }
  });

  it("une échéance dépassée déclenche aussi, et un type donné ne regarde que sa propre échéance", async () => {
    const vehicle = await vehicleWith({ insuranceExpiry: inDays(-5), nextMaintenanceDate: inDays(5) });
    const onlyInsurance = await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id, "insurance");
    expect(onlyInsurance).toHaveLength(1);
    expect(onlyInsurance[0]).toMatchObject({ title: "Renouvellement assurance", priority: "high" });
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(after.status).toBe("operational");
  });

  it("un véhicule inconnu ne produit rien", async () => {
    expect(await preventiveMaintenanceService.checkDateBasedMaintenance(2147483000, "maintenance")).toHaveLength(0);
  });

  // Manque : l'échéance d'un plan actif (`maintenance_schedules.scheduled_date`)
  // n'est lue que par `getUpcomingMaintenances` (affichage). Seules les dates
  // portées par le véhicule déclenchent un OT
  // (server/services/preventive-maintenance-service.ts:112) : un plan
  // « dans 5 jours » ne produit jamais d'OT à l'approche de l'échéance.
  it.fails("une échéance de plan actif dans la fenêtre déclenche un OT lié au plan", async () => {
    const vehicle = await vehicleWith();
    const [schedule] = await db
      .insert(maintenanceSchedules)
      .values({ vehicleId: vehicle.id, title: uniqueTestToken("plan"), frequency: "monthly", frequencyValue: 3, scheduledDate: inDays(5), isActive: true })
      .returning();
    scheduleIds.push(schedule.id);
    await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id);
    expect(await pendingFor(schedule.id)).toHaveLength(1);
  });
});

describe("MNT2 : déclenchement par kilométrage", { timeout: 120000 }, () => {
  it("sous le seuil rien ; au seuil un OT lié au plan et le seuil avance de la fréquence", async () => {
    const vehicle = await vehicleWith({}, 9999);
    const plan = await mileagePlan(vehicle.id, 10000, 5000);

    expect(await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 9999)).toHaveLength(0);
    expect(await pendingFor(plan.id)).toHaveLength(0);

    const triggered = await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 10000);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({ vehicleId: vehicle.id, isPreventive: true, maintenanceScheduleId: plan.id });
    const [after] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, plan.id));
    expect(after.scheduledMileage).toBe(15000);

    // Même relevé : le seuil a avancé, plus rien à déclencher.
    expect(await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 10000)).toHaveLength(0);
    expect(await pendingFor(plan.id)).toHaveLength(1);
  });

  it("un plan désactivé ne déclenche plus, et la réactivation le remet en service", async () => {
    const vehicle = await vehicleWith();
    const plan = await mileagePlan(vehicle.id, 1000, 1000, false);
    expect(await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 5000)).toHaveLength(0);
    expect(await pendingFor(plan.id)).toHaveLength(0);

    await db.update(maintenanceSchedules).set({ isActive: true }).where(eq(maintenanceSchedules.id, plan.id));
    expect(await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 5000)).toHaveLength(1);
  });

  it("un plan d'un autre véhicule ou d'une autre fréquence ne se déclenche pas", async () => {
    const mine = await vehicleWith();
    const other = await vehicleWith();
    const otherPlan = await mileagePlan(other.id, 1000, 1000);
    const [monthly] = await db
      .insert(maintenanceSchedules)
      .values({ vehicleId: mine.id, title: uniqueTestToken("plan"), frequency: "monthly", frequencyValue: 1, scheduledDate: inDays(1), scheduledMileage: 1, isActive: true })
      .returning();
    scheduleIds.push(monthly.id);

    expect(await preventiveMaintenanceService.checkMileageBasedMaintenance(mine.id, 50000)).toHaveLength(0);
    expect(await pendingFor(otherPlan.id)).toHaveLength(0);
    expect(await pendingFor(monthly.id)).toHaveLength(0);
  });

  it("le prochain seuil est recalculé à partir de l'ancien seuil, pas du relevé", async () => {
    const vehicle = await vehicleWith();
    const plan = await mileagePlan(vehicle.id, 10000, 5000);
    await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 12500);
    const [after] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, plan.id));
    expect(after.scheduledMileage).toBe(15000);
  });

  // Défaut : le garde-fou anti-doublon cherche un OT « pending » dont le titre
  // est celui du plan, alors que l'OT généré s'intitule « Maintenance
  // préventive: <titre> » (preventive-maintenance-service.ts:310 et :359) : la
  // garde ne trouve jamais rien. Quand le relevé dépasse deux seuils, chaque
  // passage crée un OT de plus pour le même plan, sans qu'aucun ne soit clos.
  it.fails("deux passages à un kilométrage très au-dessus du seuil ne créent qu'un seul OT en attente par plan", async () => {
    const vehicle = await vehicleWith();
    const plan = await mileagePlan(vehicle.id, 10000, 1000);
    await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 20000);
    await preventiveMaintenanceService.checkMileageBasedMaintenance(vehicle.id, 20000);
    const pending = (await pendingFor(plan.id)).filter((wo) => wo.status === "pending");
    expect(pending).toHaveLength(1);
  });
});

describe("MNT2 : plans à venir", { timeout: 120000 }, () => {
  it("liste les plans actifs échus dans la fenêtre, pas les inactifs ni les lointains", async () => {
    const vehicle = await vehicleWith();
    const make = async (days: number, isActive: boolean) => {
      const [s] = await db
        .insert(maintenanceSchedules)
        .values({ vehicleId: vehicle.id, title: uniqueTestToken("plan"), frequency: "monthly", frequencyValue: 1, scheduledDate: inDays(days), isActive })
        .returning();
      scheduleIds.push(s.id);
      return s.id;
    };
    const soon = await make(3, true);
    const off = await make(3, false);
    const later = await make(90, true);

    const upcoming = await preventiveMaintenanceService.getUpcomingMaintenances(30);
    const found = upcoming.map((job) => job.scheduleId);
    expect(found).toContain(soon);
    expect(found).not.toContain(off);
    expect(found).not.toContain(later);
    expect(upcoming.find((job) => job.scheduleId === soon)?.priority).toBe("high");
  });
});
