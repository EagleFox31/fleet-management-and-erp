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
  async function vehicleInMaintenance(label: string) {
    const v = await newVehicle(label);
    await db.update(vehicles).set({ nextMaintenanceDate: daysFromNow(10) }).where(eq(vehicles.id, v.id));
    const [wo] = await preventiveMaintenanceService.checkDateBasedMaintenance(v.id, "maintenance");
    return { v, wo };
  }

  it("l'OT genere n'immobilise pas, sa prise en charge oui, le cloturer remet operationnel", async () => {
    const { v, wo } = await vehicleInMaintenance("close-one");
    expect(await vehicleStatus(v.id)).toBe("operational");
    await storage.updateWorkOrder(wo.id, { status: "in_progress" });
    expect(await vehicleStatus(v.id)).toBe("maintenance");
    await storage.updateWorkOrder(wo.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("operational");
  });

  it("deux OT ouverts : cloturer le premier garde le vehicule en maintenance, le second le libere", async () => {
    const { v, wo } = await vehicleInMaintenance("close-two");
    const plan = await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
    const second = await preventiveMaintenanceService.generateWorkOrderFromSchedule(plan);
    expect(second.id).not.toBe(wo.id);

    await storage.updateWorkOrder(wo.id, { status: "in_progress" });
    await storage.updateWorkOrder(second.id, { status: "in_progress" });
    await storage.updateWorkOrder(wo.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("maintenance");
    await storage.updateWorkOrder(second.id, { status: "completed" });
    expect(await vehicleStatus(v.id)).toBe("operational");
  });

  // P3-2 : l'OT preventif ne s'immobilise plus a la generation, ni pour un plan, ni pour
  // vehicles.nextMaintenanceDate. Le vehicule passe en maintenance a la prise en charge.
  describe("P3-2", () => {
    it("plan echu : OT ouvert, vehicule operationnel", async () => {
      const v = await newVehicle("p3-2");
      await newSchedule(v.id, { scheduledDate: daysFromNow(-1) });
      const generes = await preventiveMaintenanceService.checkDateBasedMaintenance(v.id);
      expect(generes).toHaveLength(1);
      expect(await vehicleStatus(v.id)).toBe("operational");
      // Idempotent : un second passage ne duplique pas l'OT.
      expect(await preventiveMaintenanceService.checkDateBasedMaintenance(v.id)).toHaveLength(0);
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

  // P3-1 : cloturer un OT preventif fait avancer l'echeance de son plan. Base = echeance traitee
  // par l'OT (planning fixe) : un OT clos en retard ne fait pas deriver le plan.
  describe("P3-1", () => {
    async function closedPlan(label: string, over: Partial<typeof maintenanceSchedules.$inferInsert> = {}) {
      const v = await newVehicle(label);
      const plan = await newSchedule(v.id, over);
      const wo = await preventiveMaintenanceService.generateWorkOrderFromSchedule(plan);
      await storage.updateWorkOrder(wo.id, { status: "in_progress" });
      await storage.updateWorkOrder(wo.id, { status: "completed" });
      return { plan, wo };
    }

    it("P3-1 : cloturer l'OT preventif fait avancer l'echeance du plan", async () => {
      const from = daysFromNow(-1);
      const { plan } = await closedPlan("p3-1", { scheduledDate: from });
      const row = await scheduleRow(plan.id);
      expect(row).toBeDefined();
      expect(row.scheduledDate > from).toBe(true);
    });

    it("cloture en retard : l'echeance suivante part de l'echeance de l'OT, pas de la date de cloture", async () => {
      // Echeance du 15 janvier 2026, cloturee des mois plus tard : prochaine = 15 fevrier 2026.
      const { plan } = await closedPlan("p3-1-late", { frequency: "monthly", frequencyValue: 1, scheduledDate: "2026-01-15" });
      expect((await scheduleRow(plan.id)).scheduledDate).toBe("2026-02-15");
    });

    it("double cloture (refus qualite puis reprise) : l'echeance n'avance qu'une fois", async () => {
      const { plan, wo } = await closedPlan("p3-1-twice", { frequency: "monthly", frequencyValue: 1, scheduledDate: "2026-01-15" });
      await storage.updateWorkOrder(wo.id, { status: "in_progress" });
      await storage.updateWorkOrder(wo.id, { status: "completed" });
      expect((await scheduleRow(plan.id)).scheduledDate).toBe("2026-02-15");
      expect(await preventiveMaintenanceService.advanceScheduleAfterCompletion(wo.id)).toBeNull();
    });

    it("plan kilometrique : la date n'est pas touchee (le seuil avance a la generation)", async () => {
      const { plan } = await closedPlan("p3-1-km", { frequency: "mileage", frequencyValue: 10000, scheduledMileage: 110000, scheduledDate: "2026-01-15" });
      expect((await scheduleRow(plan.id)).scheduledDate).toBe("2026-01-15");
    });

    it("plan hebdomadaire : avance de N semaines (frequence auparavant rejetee par le calcul)", async () => {
      const { plan } = await closedPlan("p3-1-weekly", { frequency: "weekly", frequencyValue: 2, scheduledDate: "2026-01-15" });
      expect((await scheduleRow(plan.id)).scheduledDate).toBe("2026-01-29");
    });

    // Fin de mois : borne au dernier jour du mois cible, en UTC (D4), au lieu du debordement de setMonth.
    it.each([
      ["31/01 mensuel", { frequency: "monthly" as const, frequencyValue: 1, scheduledDate: "2026-01-31" }, "2026-02-28"],
      ["31/01 mensuel bissextile", { frequency: "monthly" as const, frequencyValue: 1, scheduledDate: "2028-01-31" }, "2028-02-29"],
      ["29/02 annuel", { frequency: "yearly" as const, frequencyValue: 1, scheduledDate: "2028-02-29" }, "2029-02-28"],
      ["30/11 trimestriel", { frequency: "quarterly" as const, frequencyValue: 1, scheduledDate: "2026-11-30" }, "2027-02-28"],
    ])("fin de mois (%s) : borne au dernier jour du mois", async (label, over, expected) => {
      const { plan } = await closedPlan(`p3-1-eom-${label}`, over);
      expect((await scheduleRow(plan.id)).scheduledDate).toBe(expected);
    });

    it("le plan avance, le balayage ne regenere pas d'OT pour l'echeance traitee", async () => {
      const { plan } = await closedPlan("p3-1-sweep", { frequency: "monthly", frequencyValue: 6, scheduledDate: daysFromNow(-1) });
      expect(await preventiveMaintenanceService.checkDateBasedMaintenance(plan.vehicleId)).toHaveLength(0);
    });
  });
});
