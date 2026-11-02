import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { partsUsed, tireRotations, workOrders } from "../../shared/schema";
import { technicianWorkOrdersService } from "../../server/services/technician-work-orders-service";
import { computeWorkOrderCost } from "../../shared/work-order-cost";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle } from "../support/factories";

/**
 * WO5 niveau I : le coût d'OT calculé en SQL par le serveur (liste du
 * technicien) est celui de la formule partagée utilisée par l'écran et le PDF.
 */

const ids = createIdBag();
const woIds: number[] = [];

afterAll(async () => {
  if (woIds.length) {
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
    expect(expected).toEqual({ baseCost: 12500.5, partsCost: 4150.75, tiresCost: 3000, totalCost: 19651.25 });

    const list = await technicianWorkOrdersService.getTechnicianWorkOrders(technician.id);
    const fromServer = list.find((row) => row.id === wo.id);
    expect(fromServer).toMatchObject({
      cost: expected.totalCost,
      baseCost: expected.baseCost,
      partsCost: expected.partsCost,
      tiresCost: expected.tiresCost,
    });
  });
});
