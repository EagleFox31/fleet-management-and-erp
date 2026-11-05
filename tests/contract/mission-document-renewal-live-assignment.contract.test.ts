import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, assignments, documentRenewalRequests, drivers, missions, vehicleDocuments } from "../../shared/schema";
import { leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * GET et POST /api/missions/:id/document-renewal-requests portent sur le véhicule de l'affectation
 * vivante. Une affectation annulée, même première par id (chauffeur B retiré), ne le décide pas :
 * router.param cloisonne la mission, pas l'affectation lue.
 */

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const orderNumbers: string[] = [];
let session: Awaited<ReturnType<typeof startContractActors<"logistics" | "driverA" | "driverB">>>;

const driverByActor = new Map<string, typeof drivers.$inferSelect>();

async function newDriver(actor: "driverA" | "driverB") {
  const known = driverByActor.get(actor);
  if (known) return known;
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf(actor), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORMÉ", isActive: true } as any)
    .returning();
  driverIds.push(d.id);
  driverByActor.set(actor, d);
  return d;
}

async function vehicleWithExpiredDoc() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId: v.id,
      name: "TEST carte_grise",
      type: "carte_grise",
      filename: "x.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/x.pdf",
      expiryDate: "2020-01-01",
    } as any)
    .returning();
  return { vehicle: v, doc };
}

/** Mission : B (annulé, première par id, véhicule B) puis A (vivant, véhicule A). */
async function scenario() {
  const a = await newDriver("driverA");
  const b = await newDriver("driverB");
  const vehA = await vehicleWithExpiredDoc();
  const vehB = await vehicleWithExpiredDoc();
  const orderNumber = uniqueTestToken("MIS");
  orderNumbers.push(orderNumber);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber, pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, driverId: b.id, vehicleId: vehB.vehicle.id, status: "cancelled" } as any);
  await db.insert(assignments).values({ missionId: m.id, driverId: a.id, vehicleId: vehA.vehicle.id, status: "accepted" } as any);
  return { missionId: m.id, orderNumber, vehA, vehB };
}

async function openRequest(vehicleId: number, vehicleDocumentId: number, comment: string) {
  await db.insert(documentRenewalRequests).values({ vehicleId, vehicleDocumentId, documentType: "carte_grise", status: "pending", comment } as any);
}

beforeAll(async () => {
  session = await startContractActors({ logistics: "logistics", driverA: "driver", driverB: "driver" } as const, ids.userIds);
}, 120000);

afterAll(async () => {
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

describe("document-renewal-requests : l'affectation vivante décide du véhicule", () => {
  for (const actor of ["driverA", "logistics"] as const) {
    it(`GET (${actor}) : demandes du véhicule de A, jamais celles du véhicule de l'affectation annulée`, async () => {
      const s = await scenario();
      const markA = uniqueTestToken("MARKA");
      const markB = uniqueTestToken("MARKB");
      await openRequest(s.vehA.vehicle.id, s.vehA.doc.id, markA);
      await openRequest(s.vehB.vehicle.id, s.vehB.doc.id, markB);
      const res = await session.call("GET", `/api/missions/${s.missionId}/document-renewal-requests`, { actor });
      expect(res.status).toBe(200);
      const text = leakText(res.body);
      expect(text).toContain(markA);
      expect(text).not.toContain(markB);
    }, 60000);
  }

  it("GET (chauffeur B, affectation annulée) : refusé, rien du véhicule de B ni de A", async () => {
    const s = await scenario();
    const markA = uniqueTestToken("MARKA");
    await openRequest(s.vehA.vehicle.id, s.vehA.doc.id, markA);
    const res = await session.call("GET", `/api/missions/${s.missionId}/document-renewal-requests`, { actor: "driverB" });
    expect(res.status).toBe(403);
    expect(leakText(res.body)).not.toContain(markA);
  }, 60000);

  it("POST (chauffeur A) : refusé, aucune demande créée", async () => {
    const s = await scenario();
    const res = await session.call("POST", `/api/missions/${s.missionId}/document-renewal-requests`, {
      actor: "driverA",
      body: { documentTypes: ["carte_grise"] },
    });
    expect(res.status).toBe(403);
    const rows = await db
      .select({ id: documentRenewalRequests.id })
      .from(documentRenewalRequests)
      .where(inArray(documentRenewalRequests.vehicleId, [s.vehA.vehicle.id, s.vehB.vehicle.id]));
    expect(rows).toEqual([]);
  }, 60000);

  it("POST (logistique) : la demande est créée sur le véhicule de l'affectation vivante, aucune sur celui de l'annulée", async () => {
    const s = await scenario();
    const res = await session.call("POST", `/api/missions/${s.missionId}/document-renewal-requests`, {
      actor: "logistics",
      body: { documentTypes: ["carte_grise"] },
    });
    expect(res.status).toBe(201);
    expect(res.body.createdRequestCount).toBe(1);
    const onA = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.vehicleId, s.vehA.vehicle.id));
    const onB = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.vehicleId, s.vehB.vehicle.id));
    expect(onA).toHaveLength(1);
    expect(onA[0].vehicleDocumentId).toBe(s.vehA.doc.id);
    expect(onB).toEqual([]);
    expect(leakText(res.body)).not.toContain(String(s.vehB.vehicle.registrationNumber));
  }, 60000);
});
