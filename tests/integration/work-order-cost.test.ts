import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { partsUsed, tireRotations, workOrderItems, workOrders, workshopLaborRates } from "../../shared/schema";
import { technicianWorkOrdersService } from "../../server/services/technician-work-orders-service";
import { kpiService } from "../../server/services/kpi-service";
import { laborRateForWorkOrder } from "../../server/services/workshop-labor-rates-service";
import { computeWorkOrderCost, totalLaborHours } from "../../shared/work-order-cost";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle } from "../support/factories";

/**
 * WO5 niveau I : le coût d'OT calculé en SQL par le serveur (liste du
 * technicien) est celui de la formule partagée utilisée par l'écran et le PDF.
 */

const ids = createIdBag();
const woIds: number[] = [];
const rateIds: number[] = [];

afterAll(async () => {
  if (rateIds.length) await db.delete(workshopLaborRates).where(inArray(workshopLaborRates.id, rateIds));
  if (woIds.length) {
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, woIds));
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
    await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, woIds));
    await db.delete(workOrders).where(inArray(workOrders.id, woIds));
  }
  await cleanupCreated(ids);
});

describe("Coût d'un ordre de travail (WO5)", { timeout: 120000 }, () => {
  it("serveur et formule partagée donnent le même total, détail compris", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart();
    ids.partIds.push(part.id);

    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, technicianId: technician.id, title: "TEST-wo5", cost: "12500.50" })
      .returning();
    woIds.push(wo.id);
    await db.insert(partsUsed).values([
      { workOrderId: wo.id, partId: part.id, quantity: 3, unitPrice: "1250.25" },
      { workOrderId: wo.id, partId: part.id, quantity: 1, unitPrice: "400" },
    ]);
    await db.insert(tireRotations).values([
      { vehicleId: vehicle.id, workOrderId: wo.id, rotationDate: "2026-10-01", rotationMileage: 5000,
        rotationType: "front_to_back", cost: "3000" },
      { vehicleId: vehicle.id, workOrderId: wo.id, rotationDate: "2026-10-02", rotationMileage: 5100,
        rotationType: "cross_rotation", cost: null },
    ]);

    const parts = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, wo.id));
    const rotations = await db.select().from(tireRotations).where(eq(tireRotations.workOrderId, wo.id));
    const expected = computeWorkOrderCost({ baseCost: wo.cost, parts, tireRotations: rotations });
    expect(expected).toEqual({ baseCost: 12500.5, partsCost: 4150.75, tiresCost: 3000, totalCost: 19651.25, laborValued: false });

    const list = await technicianWorkOrdersService.getTechnicianWorkOrders(technician.id);
    const fromServer = list.find((row) => row.id === wo.id);
    expect(fromServer).toMatchObject({
      cost: expected.totalCost,
      baseCost: expected.baseCost,
      partsCost: expected.partsCost,
      tiresCost: expected.tiresCost,
    });
  });

  it("taux horaire daté présent : écran = service technicien = KPI", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart();
    ids.partIds.push(part.id);

    // Date propre à ce test (contrainte unique sur la date d'effet, base partagée) ; l'OT clôt
    // avant tout autre taux posé par les suites voisines (2018 pour kpi-service-cdc).
    const [rate] = await db
      .insert(workshopLaborRates)
      .values({ effectiveFrom: "2017-06-01", hourlyRateHt: "8000" })
      .returning();
    rateIds.push(rate.id);

    const [wo] = await db
      .insert(workOrders)
      .values({
        vehicleId: vehicle.id,
        technicianId: technician.id,
        title: "TEST-wo5-taux",
        status: "completed",
        cost: "9999",
        startDate: new Date("2017-06-14T08:00:00Z"),
        endDate: new Date("2017-06-15T16:00:00Z"),
      })
      .returning();
    woIds.push(wo.id);
    await db.insert(workOrderItems).values([
      { workOrderId: wo.id, customLabel: "TEST freins", actualHours: "2.5", status: "done" },
      { workOrderId: wo.id, customLabel: "TEST annulé", actualHours: "10", status: "cancelled" },
    ]);
    await db.insert(partsUsed).values({ workOrderId: wo.id, partId: part.id, quantity: 2, unitPrice: "1500" });
    await db.insert(tireRotations).values({
      vehicleId: vehicle.id, workOrderId: wo.id, rotationDate: "2017-06-15", rotationMileage: 5000,
      rotationType: "front_to_back", cost: "2000",
    });

    // Ce que l'écran et le PDF calculent, avec le taux que leur sert la route.
    const served = await laborRateForWorkOrder(wo.id);
    expect(served).toEqual({ effectiveFrom: "2017-06-01", hourlyRateHt: 8000 });
    const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, wo.id));
    const screen = computeWorkOrderCost({
      baseCost: wo.cost,
      parts: await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, wo.id)),
      tireRotations: await db.select().from(tireRotations).where(eq(tireRotations.workOrderId, wo.id)),
      laborHours: totalLaborHours(items),
      laborRate: served?.hourlyRateHt ?? null,
    });
    expect(screen).toEqual({ baseCost: 20000, partsCost: 3000, tiresCost: 2000, totalCost: 25000, laborValued: true });

    const list = await technicianWorkOrdersService.getTechnicianWorkOrders(technician.id);
    expect(list.find((row) => row.id === wo.id)).toMatchObject({
      cost: 25000, baseCost: 20000, partsCost: 3000, tiresCost: 2000,
    });

    // KPI : seul OT clos ce jour-là sur ce véhicule.
    const byVehicle = await kpiService.maintenanceCosts({ from: "2017-06-15", to: "2017-06-15", groupBy: "vehicle" });
    expect(byVehicle.groups.find((g) => g.key === String(vehicle.id))).toMatchObject({ interventions: 1, totalCost: 25000 });
  });

  it("liste de plusieurs OT : chaque coût reste celui de son OT (calcul groupé)", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart();
    ids.partIds.push(part.id);

    // Date propre à ce test (contrainte unique sur la date d'effet, base partagée).
    const [rate] = await db
      .insert(workshopLaborRates)
      .values({ effectiveFrom: "2019-04-01", hourlyRateHt: "5000" })
      .returning();
    rateIds.push(rate.id);

    // A : clos sous le taux 2019, valorisé aux heures. B : clos avant tout taux, coût saisi.
    // C : aucune ligne liée, coût saisi seul.
    const [a, b, c] = await db
      .insert(workOrders)
      .values([
        { vehicleId: vehicle.id, technicianId: technician.id, title: "TEST-wo5-lot-a", status: "completed", cost: "1",
          startDate: new Date("2019-04-10T08:00:00Z"), endDate: new Date("2019-04-11T16:00:00Z") },
        { vehicleId: vehicle.id, technicianId: technician.id, title: "TEST-wo5-lot-b", status: "completed", cost: "700",
          startDate: new Date("2000-02-10T08:00:00Z"), endDate: new Date("2000-02-11T16:00:00Z") },
        { vehicleId: vehicle.id, technicianId: technician.id, title: "TEST-wo5-lot-c", cost: "300" },
      ])
      .returning();
    woIds.push(a.id, b.id, c.id);
    await db.insert(workOrderItems).values([
      { workOrderId: a.id, customLabel: "TEST a", actualHours: "3", status: "done" },
      { workOrderId: b.id, customLabel: "TEST b", actualHours: "4", status: "done" },
    ]);
    await db.insert(partsUsed).values([
      { workOrderId: a.id, partId: part.id, quantity: 1, unitPrice: "100" },
      { workOrderId: b.id, partId: part.id, quantity: 2, unitPrice: "50" },
    ]);
    await db.insert(tireRotations).values({
      vehicleId: vehicle.id, workOrderId: b.id, rotationDate: "2000-02-11", rotationMileage: 1000,
      rotationType: "front_to_back", cost: "40",
    });

    const list = await technicianWorkOrdersService.getTechnicianWorkOrders(technician.id);
    const byId = new Map(list.map((row) => [row.id, row]));
    expect(byId.get(a.id)).toMatchObject({ baseCost: 15000, partsCost: 100, tiresCost: 0, cost: 15100 });
    expect(byId.get(b.id)).toMatchObject({ baseCost: 700, partsCost: 100, tiresCost: 40, cost: 840 });
    expect(byId.get(c.id)).toMatchObject({ baseCost: 300, partsCost: 0, tiresCost: 0, cost: 300 });
  });
});
