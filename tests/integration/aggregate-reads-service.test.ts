import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import {
  clientInvoices,
  fuelRecords,
  missions,
  partsUsed,
  tireInspections,
  tireRotationDetails,
  tireRotations,
  tires,
  vehicleTires,
  workOrders,
} from "../../shared/schema";
import { aggregateReadsService } from "../../server/services/aggregate-reads-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestPart, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

const ids = createIdBag();
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  for (const fn of cleanups.reverse()) await fn();
  cleanups.length = 0;
  await cleanupCreated(ids);
  ids.partIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.clientIds.length = 0;
});

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("aggregateReadsService.vehicleCostSummary", () => {
  it("additionne main-d'oeuvre, pièces et carburant sans produit cartésien", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const part = await createTestPart();
    ids.partIds.push(part.id);
    const wos = await db
      .insert(workOrders)
      .values([
        { vehicleId: v.id, title: "TEST-a", status: "completed", startDate: at("2019-05-02"), endDate: at("2019-05-03"), cost: "10000" },
        { vehicleId: v.id, title: "TEST-b", status: "completed", startDate: at("2019-05-10"), endDate: at("2019-05-10"), cost: "4000" },
        { vehicleId: v.id, title: "TEST-c", status: "cancelled", startDate: at("2019-05-11"), cost: "99999" },
        { vehicleId: v.id, title: "TEST-hors", status: "completed", startDate: at("2019-07-01"), endDate: at("2019-07-01"), cost: "777" },
      ])
      .returning();
    const woIds = wos.map((w) => w.id);
    await db.insert(partsUsed).values([
      { workOrderId: wos[0].id, partId: part.id, quantity: 2, unitPrice: "1500" },
      { workOrderId: wos[0].id, partId: part.id, quantity: 1, unitPrice: "500" },
      { workOrderId: wos[1].id, partId: part.id, quantity: 1, unitPrice: "2000" },
    ]);
    const fuel = await db
      .insert(fuelRecords)
      .values([
        { vehicleId: v.id, date: "2019-05-04", quantity: 100, cost: "82800" },
        { vehicleId: v.id, date: "2019-05-20", quantity: 50, cost: "41400" },
        { vehicleId: v.id, date: "2019-08-01", quantity: 10, cost: "8280" },
      ])
      .returning();
    ids.fuelRecordIds.push(...fuel.map((f) => f.id));
    cleanups.push(async () => {
      await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
      await db.delete(workOrders).where(inArray(workOrders.id, woIds));
    });

    const res = await aggregateReadsService.vehicleCostSummary(v.id, { from: "2019-05-01", to: "2019-06-30" });
    expect(res).toMatchObject({
      vehicleId: v.id,
      labor: 14000,
      parts: 5500,
      fuel: 124200,
      total: 143700,
      workOrderCount: 2,
      fuelLiters: 150,
    });
  }, 30_000);
});

describe("aggregateReadsService.tireMovements", () => {
  it("reconstitue montage, rotation, inspection et démontage", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const [tire] = await db
      .insert(tires)
      .values({ brand: "TEST-Brand", model: uniqueTestToken("m"), size: "315/80R22.5" })
      .returning();
    const [vt] = await db
      .insert(vehicleTires)
      .values({
        vehicleId: v.id, tireId: tire.id, position: "front_left",
        installationDate: "2019-02-01", installationMileage: 1000,
        removalDate: "2019-02-20", removalMileage: 5000, status: "removed",
      })
      .returning();
    const [rot] = await db
      .insert(tireRotations)
      .values({ vehicleId: v.id, rotationDate: "2019-02-10", rotationMileage: 3000, rotationType: "front_to_back" })
      .returning();
    await db.insert(tireRotationDetails).values({
      rotationId: rot.id, vehicleTireId: vt.id, fromPosition: "front_left", toPosition: "rear_left_outer",
    });
    await db.insert(tireInspections).values({
      vehicleTireId: vt.id, inspectionDate: "2019-02-15", inspectionMileage: 4000, condition: "good",
    });
    cleanups.push(async () => {
      await db.delete(tireInspections).where(eq(tireInspections.vehicleTireId, vt.id));
      await db.delete(tireRotationDetails).where(eq(tireRotationDetails.rotationId, rot.id));
      await db.delete(tireRotations).where(eq(tireRotations.id, rot.id));
      await db.delete(vehicleTires).where(eq(vehicleTires.id, vt.id));
      await db.delete(tires).where(eq(tires.id, tire.id));
    });

    const all = await aggregateReadsService.tireMovements({ tireId: tire.id });
    expect(all.map((m) => m.kind)).toEqual(["removed", "inspected", "rotated", "installed"]);
    expect(all[0]).toMatchObject({ tireId: tire.id, vehicleId: v.id, mileage: 5000, at: "2019-02-20T00:00:00.000Z" });
    expect(all[2].position).toBe("rear_left_outer");

    const windowed = await aggregateReadsService.tireMovements({ tireId: tire.id, from: "2019-02-12", to: "2019-02-16" });
    expect(windowed.map((m) => m.kind)).toEqual(["inspected"]);
    expect(await aggregateReadsService.tireMovements({ tireId: tire.id, vehicleId: v.id + 100000 })).toEqual([]);
  }, 30_000);
});

describe("aggregateReadsService.pendingInvoices", () => {
  it("liste les missions terminées sans facture active, par client", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const mk = (n: string, status: "completed" | "in_progress", day: string) => ({
      clientId: client.id, orderNumber: uniqueTestToken(n), pickupAddress: "A", deliveryAddress: "B",
      status, completedAt: at(day), createdAt: at(day),
    });
    const ms = await db
      .insert(missions)
      .values([mk("m1", "completed", "2019-01-10"), mk("m2", "completed", "2019-01-20"), mk("m3", "completed", "2019-01-25"), mk("m4", "in_progress", "2019-01-05")])
      .returning();
    const [inv] = await db
      .insert(clientInvoices)
      .values({
        missionId: ms[1].id, clientId: client.id, invoiceNumber: uniqueTestToken("inv"),
        invoiceDate: "2019-02-01", dueDate: "2019-03-01", amountHT: "100", amountTTC: "119", balance: "119",
      })
      .returning();
    cleanups.push(async () => {
      await db.delete(clientInvoices).where(eq(clientInvoices.id, inv.id));
      await db.delete(missions).where(inArray(missions.id, ms.map((m) => m.id)));
    });

    const res = await aggregateReadsService.pendingInvoices();
    const mine = res.find((r) => r.clientId === client.id);
    expect(mine).toEqual({
      clientId: client.id, clientName: client.name, operationCount: 2, amount: 0, missionsWithoutPrice: 2, oldestOperationDate: "2019-01-10",
    });
  }, 30_000);
});
