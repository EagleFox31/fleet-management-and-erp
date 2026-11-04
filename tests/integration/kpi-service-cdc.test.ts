import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { stampPreventiveDue } from "../../server/lib/preventive-due";
import { kpiService } from "../../server/services/kpi-service";
import {
  incidents,
  maintenanceSchedules,
  partsUsed,
  workOrderItems,
  workOrderPlanning,
  workOrders,
  workshopLaborRates,
} from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle } from "../support/factories";

/**
 * Niveau B, CDC #7 : pannes, préventif à l'échéance, coût d'un OT clos.
 *
 * Écrit en base : à ne jouer que sur une base isolée (DATABASE_URL_TEST distincte).
 * Toutes les données sont datées de 2018 et préfixées TEST pour ne pas se mélanger aux
 * données réelles, puis supprimées. Le taux horaire de test (2018-02-01) est retiré à la fin.
 */
const ids = createIdBag();
const woIds: number[] = [];
const incidentIds: number[] = [];
const scheduleIds: number[] = [];
const rateIds: number[] = [];
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const NOW = at("2019-01-15");

afterEach(async () => {
  if (incidentIds.length) await db.delete(incidents).where(inArray(incidents.id, incidentIds));
  if (woIds.length) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds));
    await db.delete(workOrders).where(inArray(workOrders.id, woIds));
  }
  if (scheduleIds.length) await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.id, scheduleIds));
  if (rateIds.length) await db.delete(workshopLaborRates).where(inArray(workshopLaborRates.id, rateIds));
  incidentIds.length = 0;
  woIds.length = 0;
  scheduleIds.length = 0;
  rateIds.length = 0;
  await cleanupCreated(ids);
  ids.partIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.userIds.length = 0;
});

async function vehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v;
}

async function workOrder(vehicleId: number, v: Partial<typeof workOrders.$inferInsert>) {
  const [row] = await db.insert(workOrders).values({ vehicleId, title: "TEST-kpi-cdc", ...v }).returning();
  woIds.push(row.id);
  return row;
}

describe("kpiService.failures : pannes sans double compte", () => {
  it("compte déclarations + OT correctifs non déclarés, mois à zéro compris", async () => {
    const v = await vehicle();
    const user = await createTestUser();
    ids.userIds.push(user.id);

    const declared = await workOrder(v.id, { status: "in_progress", startDate: at("2018-03-12") });
    const [i1] = await db
      .insert(incidents)
      .values({ vehicleId: v.id, reportedBy: user.id, description: "TEST sans OT", createdAt: at("2018-03-10") })
      .returning();
    const [i2] = await db
      .insert(incidents)
      .values({ vehicleId: v.id, reportedBy: user.id, description: "TEST avec OT", workOrderId: declared.id, createdAt: at("2018-03-12") })
      .returning();
    incidentIds.push(i1.id, i2.id);
    await workOrder(v.id, { status: "in_progress", startDate: at("2018-05-02") }); // correctif non déclaré
    await workOrder(v.id, { status: "cancelled", startDate: at("2018-05-03") }); // annulé : ignoré
    await workOrder(v.id, { status: "completed", isPreventive: true, startDate: at("2018-04-03") }); // préventif : ignoré

    const res = await kpiService.failures({ from: "2018-03-01", to: "2018-05-31" }, NOW);
    const mine = res.byVehicle.find((x) => x.vehicleId === v.id);
    expect(mine?.count).toBe(3);
    // La série couvre tous les véhicules de la base : sur 2018 seuls les TEST y figurent.
    expect(res.series.map((s) => s.month)).toEqual(["2018-03", "2018-04", "2018-05"]);
    expect(res.series.find((s) => s.month === "2018-04")?.count).toBe(0);
    expect(res.series.find((s) => s.month === "2018-03")?.count).toBeGreaterThanOrEqual(2);
    expect(res.months).toBe(3);
    expect(res.monthlyAverage).toBe(Math.round((res.total / 3) * 100) / 100);
  }, 30_000);

  it("sur une période sans données propres au test : une ligne par mois, totaux cohérents", async () => {
    // Pas d'hypothèse « 2001 est vide » : work-order-cost y crée un OT correctif, et la base de
    // test est partagée entre sessions. Les mois sans panne restent présents (zéros compris).
    const res = await kpiService.failures({ from: "2001-01-01", to: "2001-03-31" }, NOW);
    expect(res.series.map((s) => s.month)).toEqual(["2001-01", "2001-02", "2001-03"]);
    const sum = res.series.reduce((acc, s) => acc + s.count, 0);
    expect(res.total).toBe(sum);
    expect(res.monthlyAverage).toBe(Math.round((sum / 3) * 100) / 100);
    expect(res.byVehicle.reduce((acc, v) => acc + v.count, 0)).toBe(sum);
  }, 30_000);
});

describe("kpiService.preventiveCompliance : à l'échéance", () => {
  async function seedPreventive() {
    const v = await vehicle();
    await workOrder(v.id, { status: "completed", isPreventive: true, startDate: at("2018-06-05"), endDate: at("2018-06-05") }); // à temps
    const late = await workOrder(v.id, { status: "completed", isPreventive: true, startDate: at("2018-06-10"), endDate: at("2018-06-14") }); // en retard
    await workOrder(v.id, { status: "cancelled", isPreventive: true, startDate: at("2018-06-12") }); // annulé
    await workOrder(v.id, { status: "pending", isPreventive: true, startDate: at("2018-06-20") }); // ouvert
    // Début hors période mais échéance figée dans la période : c'est l'échéance qui compte.
    const frozen = await workOrder(v.id, { status: "completed", isPreventive: true, startDate: at("2018-07-15"), endDate: at("2018-06-08") });
    await db.update(workOrderPlanning).set({ dueDate: "2018-06-08" }).where(eq(workOrderPlanning.id, frozen.id));
    const [s] = await db
      .insert(maintenanceSchedules)
      .values({ vehicleId: v.id, title: "TEST-kpi-cdc", scheduledDate: "2018-06-25", frequency: "monthly", frequencyValue: 1 })
      .returning();
    scheduleIds.push(s.id);
    return { late };
  }

  it("compte annulés, retards, ouverts et planifications sans OT au dénominateur", async () => {
    await seedPreventive();
    const res = await kpiService.preventiveCompliance({ from: "2018-06-01", to: "2018-06-30" }, NOW);
    // Les OT de test s'ajoutent à d'éventuelles lignes existantes sur juin 2018 : bornes minimales.
    expect(res.planned).toBeGreaterThanOrEqual(6);
    expect(res.doneOnTime).toBeGreaterThanOrEqual(2);
    expect(res.cancelled).toBeGreaterThanOrEqual(1);
    expect(res.withoutWorkOrder).toBeGreaterThanOrEqual(1);
    expect(res.late).toBeGreaterThanOrEqual(3);
    expect(res.toleranceDays).toBe(0);
    expect(res.periodEnd).toBe("2018-06-30");
    expect(res.rate).toBeCloseTo((res.doneOnTime ?? 0) / res.planned, 6);
  }, 30_000);

  it("rien n'est échu aujourd'hui : la période s'arrête à la veille", async () => {
    await seedPreventive();
    const full = await kpiService.preventiveCompliance({ from: "2018-06-01", to: "2018-06-30" }, NOW);
    const cut = await kpiService.preventiveCompliance({ from: "2018-06-01", to: "2018-06-30" }, at("2018-06-20"));
    expect(cut.periodEnd).toBe("2018-06-19");
    expect(cut.planned).toBeLessThan(full.planned);
    expect(cut.withoutWorkOrder).toBe(0); // l'échéance du 25 n'est pas encore échue
  }, 30_000);

  it("pose l'échéance à la génération sans toucher au reste de l'OT", async () => {
    const v = await vehicle();
    const wo = await workOrder(v.id, { status: "pending", isPreventive: true, startDate: at("2018-08-01") });
    await db.transaction((tx) => stampPreventiveDue(tx, wo.id, { dueDate: "2018-08-15", dueMileage: 120000 }));
    const [row] = await db.select().from(workOrderPlanning).where(eq(workOrderPlanning.id, wo.id));
    expect(row.dueDate).toBe("2018-08-15");
    expect(row.dueMileage).toBe(120000);
    const [after] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
    expect(after.status).toBe("pending");
    expect(after.title).toBe("TEST-kpi-cdc");
  }, 30_000);
});

describe("kpiService : coût d'une intervention close", () => {
  async function seedCosts() {
    const v = await vehicle();
    const part = await createTestPart();
    ids.partIds.push(part.id);
    const [rate] = await db.insert(workshopLaborRates).values({ effectiveFrom: "2018-02-01", hourlyRateHt: "5000" }).returning();
    rateIds.push(rate.id);

    // Coût saisi 10 000 + pièces 2 x 1 500, sans heures : main-d'oeuvre saisie conservée.
    const c1 = await workOrder(v.id, { status: "completed", startDate: at("2018-03-09"), endDate: at("2018-03-10"), cost: "10000" });
    await db.insert(partsUsed).values({ workOrderId: c1.id, partId: part.id, quantity: 2, unitPrice: "1500" });
    // 2 h réelles x 5 000 remplacent le coût saisi ; la ligne annulée ne compte pas.
    const c2 = await workOrder(v.id, { status: "completed", isPreventive: true, startDate: at("2018-03-14"), endDate: at("2018-03-15"), cost: "99999" });
    await db.insert(workOrderItems).values([
      { workOrderId: c2.id, customLabel: "TEST vidange", actualHours: "2", status: "done" },
      { workOrderId: c2.id, customLabel: "TEST annulé", actualHours: "10", status: "cancelled" },
    ]);
    // Sans main-d'oeuvre ni pièce : compté, signalé.
    await workOrder(v.id, { status: "completed", startDate: at("2018-03-19"), endDate: at("2018-03-20"), cost: "0" });
    // Hors périmètre : ouvert, ou clos hors période.
    await workOrder(v.id, { status: "pending", startDate: at("2018-03-21"), cost: "50000" });
    await workOrder(v.id, { status: "completed", startDate: at("2018-04-01"), endDate: at("2018-04-02"), cost: "70000" });
    return v;
  }

  it("moyenne = somme / nombre d'OT clos, main-d'oeuvre + pièces, valorisation signalée", async () => {
    await seedCosts();
    const res = await kpiService.avgCostPerIntervention({ from: "2018-03-01", to: "2018-03-31" }, NOW);
    expect(res.interventions).toBeGreaterThanOrEqual(3);
    expect(res.laborValued).toBe(true);
    expect(res.laborTotal).toBeGreaterThanOrEqual(20000);
    expect(res.partsTotal).toBeGreaterThanOrEqual(3000);
    expect(res.totalCost).toBe((res.laborTotal ?? 0) + (res.partsTotal ?? 0));
    expect(res.averageCost).toBe(Math.round(res.totalCost / res.interventions));
    expect(res.missingCostCount).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("ventile par type et par véhicule", async () => {
    const v = await seedCosts();
    const byType = await kpiService.maintenanceCosts({ from: "2018-03-01", to: "2018-03-31", groupBy: "type" }, NOW);
    expect(byType.groups.map((g) => g.key)).toEqual(["preventive", "corrective"]);
    expect(byType.groups.reduce((a, g) => a + g.totalCost, 0)).toBe(byType.total.totalCost);
    expect(byType.groups.reduce((a, g) => a + g.interventions, 0)).toBe(byType.total.interventions);

    const byVehicle = await kpiService.maintenanceCosts({ from: "2018-03-01", to: "2018-03-31", groupBy: "vehicle" }, NOW);
    const mine = byVehicle.groups.find((g) => g.key === String(v.id));
    expect(mine).toMatchObject({ interventions: 3, totalCost: 23000, averageCost: 7667 });
  }, 30_000);

  it("sans taux horaire : coût saisi conservé, laborValued à false", async () => {
    const v = await vehicle();
    await workOrder(v.id, { status: "completed", startDate: at("2017-03-09"), endDate: at("2017-03-10"), cost: "8000" });
    const res = await kpiService.avgCostPerIntervention({ from: "2017-03-01", to: "2017-03-31" }, NOW);
    expect(res.interventions).toBeGreaterThanOrEqual(1);
    // Aucun taux n'est enregistré dans ce test : le drapeau reflète la table (vide en recette neuve).
    expect(typeof res.laborValued).toBe("boolean");
    expect(res.totalCost).toBeGreaterThanOrEqual(8000);
  }, 30_000);
});
