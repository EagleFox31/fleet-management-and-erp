import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { alerts, maintenanceSchedules, vehicles, workOrders } from "../../shared/schema";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alertService } from "../../server/services/alert-service";
import { preventiveMaintenanceService } from "../../server/services/preventive-maintenance-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * P3 : cycle de vie d'un plan de maintenance preventive, apres MNT1/MNT2
 * (plan -> echeance -> OT preventif -> vehicule en maintenance).
 *   1. l'alerte emise a l'echeance (date et kilometrage), sans doublon le meme jour ;
 *   2. la cloture de l'OT preventif remet le vehicule en exploitation ;
 *   3. le recalcul de la prochaine echeance (date, kilometrage).
 *
 * Le balayage d'alertes parcourt tous les vehicules : `getVehicles` est borne au vehicule
 * de test pour ne pas toucher aux donnees partagees.
 */
const ids = createIdBag();
const scheduleIds: number[] = [];
const vehicleOf = new Map<string, number>();
let adminId = 0;
let managerId = 0;
let technicianId = 0;

const iso = (d: Date) => d.toISOString().split("T")[0];
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86400000));

async function newVehicle(label: string, overrides: Parameters<typeof createTestVehicle>[0] = {}) {
  const v = await createTestVehicle(overrides);
  ids.vehicleIds.push(v.id);
  vehicleOf.set(label, v.id);
  return v;
}

async function newSchedule(vehicleId: number, over: Partial<typeof maintenanceSchedules.$inferInsert> = {}) {
  const [row] = await db
    .insert(maintenanceSchedules)
    .values({
      vehicleId,
      title: uniqueTestToken("plan"),
      frequency: "monthly",
      frequencyValue: 1,
      scheduledDate: daysFromNow(-2),
      isActive: true,
      ...over,
    } as typeof maintenanceSchedules.$inferInsert)
    .returning();
  scheduleIds.push(row.id);
  return row;
}

async function alertsFor(scheduleId: number, userId: number) {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.link, `/maintenance/schedules/${scheduleId}`)));
}

async function scheduleRow(id: number) {
  const [row] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
  return row;
}

async function vehicleStatus(id: number) {
  const [row] = await db.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, id));
  return row.status;
}

beforeAll(async () => {
  const [admin, manager, technician] = await Promise.all([
    createTestUser({ role: "admin" }),
    createTestUser({ role: "workshop_manager" }),
    createTestUser({ role: "technician" }),
  ]);
  ids.userIds.push(admin.id, manager.id, technician.id);
  [adminId, managerId, technicianId] = [admin.id, manager.id, technician.id];
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  const vids = ids.vehicleIds;
  if (scheduleIds.length > 0) {
    await db.delete(alerts).where(
      inArray(alerts.link, scheduleIds.map((id) => `/maintenance/schedules/${id}`)),
    );
  }
  if (vids.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, vids));
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, vids));
  }
  await cleanupCreated(ids);
}, 120000);

/** Balayage d'alertes limite a un vehicule. */
async function sweepAlertsFor(vehicleId: number) {
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  const spy = vi.spyOn(storage, "getVehicles").mockResolvedValue({ vehicles: [vehicle], total: 1 } as any);
  try {
    await alertService.checkMaintenanceScheduleAlerts();
  } finally {
    spy.mockRestore();
  }
}

describe("P3 alerte a l'echeance du plan", { timeout: 120000 }, () => {
  it("plan date echu : alerte maintenance pour l'administrateur et le chef d'atelier, lien du plan", async () => {
    const v = await newVehicle("alert-date");
    const plan = await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
    await sweepAlertsFor(v.id);

    for (const userId of [adminId, managerId]) {
      const rows = await alertsFor(plan.id, userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("maintenance");
      expect(rows[0].title).toBe("Maintenance préventive programmée due");
    }
    expect(await alertsFor(plan.id, technicianId)).toHaveLength(0);
  });

  it("rejouer le balayage le meme jour ne double pas l'alerte", async () => {
    const v = await newVehicle("alert-replay");
    const plan = await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
    await sweepAlertsFor(v.id);
    await sweepAlertsFor(v.id);
    expect(await alertsFor(plan.id, adminId)).toHaveLength(1);
  });

  it("plan a echeance lointaine ou inactif : aucune alerte", async () => {
    const v = await newVehicle("alert-none");
    const future = await newSchedule(v.id, { scheduledDate: daysFromNow(90) });
    const inactive = await newSchedule(v.id, { scheduledDate: daysFromNow(-5), isActive: false });
    await sweepAlertsFor(v.id);
    expect(await alertsFor(future.id, adminId)).toHaveLength(0);
    expect(await alertsFor(inactive.id, adminId)).toHaveLength(0);
  });

  it("plan kilometrique : alerte quand le compteur atteint le seuil, rien en dessous", async () => {
    const reached = await newVehicle("alert-km-ok", { mileage: 120500 });
    const below = await newVehicle("alert-km-ko", { mileage: 90000 });
    const planReached = await newSchedule(reached.id, {
      frequency: "mileage",
      frequencyValue: 10000,
      scheduledMileage: 120000,
      scheduledDate: daysFromNow(400),
    });
    const planBelow = await newSchedule(below.id, {
      frequency: "mileage",
      frequencyValue: 10000,
      scheduledMileage: 120000,
      scheduledDate: daysFromNow(400),
    });
    await sweepAlertsFor(reached.id);
    await sweepAlertsFor(below.id);

    const rows = await alertsFor(planReached.id, adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Maintenance préventive kilométrage due");
    expect(await alertsFor(planBelow.id, adminId)).toHaveLength(0);
  });
});

describe("P3 cloture de l'OT preventif et retour en exploitation", { timeout: 120000 }, () => {
  /** Echeance de maintenance du vehicule : OT preventif et immobilisation (voir MNT2). */
  async function immobilised(label: string) {
    const v = await newVehicle(label);
    await db.update(vehicles).set({ nextMaintenanceDate: daysFromNow(10) }).where(eq(vehicles.id, v.id));
    const [wo] = await preventiveMaintenanceService.checkDateBasedMaintenance(v.id, "maintenance");
    return { v, wo };
  }

  it("l'OT genere immobilise le vehicule, le cloturer le remet operationnel", async () => {
    const { v, wo } = await immobilised("close-one");
    expect(await vehicleStatus(v.id)).toBe("maintenance");
    await storage.updateWorkOrder(wo.id, { status: "in_progress" });
    expect(await vehicleStatus(v.id)).toBe("maintenance");
    await storage.updateWorkOrder(wo.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("operational");
  });

  it("deux OT ouverts : cloturer le premier garde le vehicule en maintenance, le second le libere", async () => {
    const { v, wo } = await immobilised("close-two");
    const plan = await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
    const second = await preventiveMaintenanceService.generateWorkOrderFromSchedule(plan);
    expect(second.id).not.toBe(wo.id);

    await storage.updateWorkOrder(wo.id, { status: "in_progress" });
    await storage.updateWorkOrder(wo.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("maintenance");
    await storage.updateWorkOrder(second.id, { status: "in_progress" });
    await storage.updateWorkOrder(second.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("operational");
  });

  // P3-2 : l'OT issu d'un plan (maintenanceSchedules) ne declenche pas l'immobilisation, seul
  // l'OT issu de vehicles.nextMaintenanceDate le fait (variable declencheur de checkDateBasedMaintenance).
  describe("P3-2", () => {
    let vehicleId = 0;
    beforeAll(async () => {
      const v = await newVehicle("p3-2");
      vehicleId = v.id;
      await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
      expect(await preventiveMaintenanceService.checkDateBasedMaintenance(v.id)).toHaveLength(1);
    });
    // Temoin : le vehicule existe et reste aujourd'hui operationnel. Casse quand P3-2 est tranche.
    it("temoin P3-2 : le vehicule d'un plan echu reste operationnel", async () => {
      expect(await vehicleStatus(vehicleId)).toBe("operational");
    });
    it.fails("P3-2 : l'OT issu d'un plan echu immobilise aussi le vehicule", async () => {
      expect(await vehicleStatus(vehicleId)).toBe("maintenance");
    });
  });
});

describe("P3 recalcul de la prochaine echeance", { timeout: 120000 }, () => {
  it.each([
    ["monthly", 1, "2031-03-15", "2031-04-15"],
    ["quarterly", 1, "2031-03-15", "2031-06-15"],
    ["yearly", 1, "2031-03-15", "2032-03-15"],
  ] as const)("plan %s : %s fois la periode a partir de l'echeance", async (frequency, value, from, expected) => {
    const v = await newVehicle(`next-${frequency}`);
    const plan = await newSchedule(v.id, { frequency, frequencyValue: value, scheduledDate: from });
    const updated = await preventiveMaintenanceService.completeMaintenanceAndScheduleNext(plan.id);
    expect(updated?.scheduledDate).toBe(expected);
    expect((await scheduleRow(plan.id)).scheduledDate).toBe(expected);
  });

  it("plan kilometrique : l'echeance en date avance de ceil(frequence/1000) mois, le seuil kilometrique est inchange", async () => {
    const v = await newVehicle("next-km");
    const plan = await newSchedule(v.id, {
      frequency: "mileage",
      frequencyValue: 10000,
      scheduledMileage: 120000,
      scheduledDate: "2031-03-15",
    });
    const updated = await preventiveMaintenanceService.completeMaintenanceAndScheduleNext(plan.id);
    expect(updated?.scheduledDate).toBe("2032-01-15");
    expect(updated?.scheduledMileage).toBe(120000);
  });

  it("plan inconnu : rien n'est cree ni modifie (null)", async () => {
    expect(await preventiveMaintenanceService.completeMaintenanceAndScheduleNext(2147483000)).toBeNull();
  });

  it("seuil kilometrique : franchi, il avance de la frequence et l'OT n'est genere qu'une fois", async () => {
    const v = await newVehicle("next-threshold", { mileage: 100000 });
    const plan = await newSchedule(v.id, {
      frequency: "mileage",
      frequencyValue: 10000,
      scheduledMileage: 110000,
      scheduledDate: daysFromNow(400),
    });
    const first = await preventiveMaintenanceService.checkMileageBasedMaintenance(v.id, 110200);
    expect(first).toHaveLength(1);
    expect((await scheduleRow(plan.id)).scheduledMileage).toBe(120000);
    const again = await preventiveMaintenanceService.checkMileageBasedMaintenance(v.id, 110300);
    expect(again).toHaveLength(0);
  });

  // P3-1 : rien n'appelle completeMaintenanceAndScheduleNext. Cloturer un OT preventif ne fait
  // pas avancer la date du plan, qui reste echue ; et comme le service ecarte les plans dont
  // un OT clos a demarre apres `scheduledDate`, le plan ne declenche plus jamais d'OT.
  describe("P3-1", () => {
    let planId = 0;
    const from = daysFromNow(-1);
    beforeAll(async () => {
      const v = await newVehicle("p3-1");
      const plan = await newSchedule(v.id, { scheduledDate: from });
      planId = plan.id;
      const wo = await preventiveMaintenanceService.generateWorkOrderFromSchedule(plan);
      await storage.updateWorkOrder(wo.id, { status: "in_progress" });
      await storage.updateWorkOrder(wo.id, { status: "completed" });
    });
    // Temoin : le plan existe et garde aujourd'hui sa date echue. Sans lui, un plan absent
    // (scheduleRow -> undefined) ferait passer le marqueur. Casse quand P3-1 est corrige.
    it("temoin P3-1 : apres cloture de l'OT, le plan garde sa date echue", async () => {
      const row = await scheduleRow(planId);
      expect(row).toBeDefined();
      expect(row.scheduledDate).toBe(from);
    });
    it.fails("P3-1 : cloturer l'OT preventif fait avancer l'echeance du plan", async () => {
      expect((await scheduleRow(planId)).scheduledDate).not.toBe(from);
    });
  });
});
