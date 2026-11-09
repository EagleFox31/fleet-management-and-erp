import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts, assignments, documentRenewalRequests, drivers, missions, vehicleDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * La lecture des alertes non lues ne sert qu'à éviter un doublon : si elle échoue, la demande de
 * renouvellement reste créée (201). Elle ne doit jamais faire échouer la mutation.
 */

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const orderNumbers: string[] = [];
let session: Awaited<ReturnType<typeof startContractActors<"logistics" | "admin" | "driverA">>>;

beforeAll(async () => {
  session = await startContractActors({ logistics: "logistics", admin: "admin", driverA: "driver" } as const, ids.userIds);
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const orderNumber of orderNumbers) await db.delete(alerts).where(like(alerts.message, `%${orderNumber}%`));
  if (ids.vehicleIds.length > 0) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds));
    await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
  }
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("document-renewal-requests : lecture des alertes en échec", () => {
  it("POST (logistique) reste en 201 et crée la demande quand getUnreadAlertsByUserId lève", async () => {
    const [driver] = await db
      .insert(drivers)
      .values({ userId: session.userIdOf("driverA"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORMÉ", isActive: true } as any)
      .returning();
    driverIds.push(driver.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await db.insert(vehicleDocuments).values({
      vehicleId: vehicle.id,
      name: "TEST carte_grise",
      type: "carte_grise",
      filename: "x.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/x.pdf",
      expiryDate: "2020-01-01",
    } as any);
    const orderNumber = uniqueTestToken("MIS");
    orderNumbers.push(orderNumber);
    const [mission] = await db
      .insert(missions)
      .values({ orderNumber, pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned" } as any)
      .returning();
    missionIds.push(mission.id);
    await db.insert(assignments).values({ missionId: mission.id, driverId: driver.id, vehicleId: vehicle.id, status: "accepted" } as any);

    const spy = vi.spyOn(storage, "getUnreadAlertsByUserId").mockRejectedValue(new Error("timeout exceeded when trying to connect"));
    const res = await session.call("POST", `/api/missions/${mission.id}/document-renewal-requests`, {
      actor: "logistics",
      body: { documentTypes: ["carte_grise"] },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.createdRequestCount).toBe(1);
    const rows = await db.select({ id: documentRenewalRequests.id }).from(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, [vehicle.id]));
    expect(rows).toHaveLength(1);
  }, 60000);
});
