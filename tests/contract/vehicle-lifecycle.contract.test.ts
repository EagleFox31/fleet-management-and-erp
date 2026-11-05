import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import {
  assignments,
  documentRenewalRequests,
  drivers,
  maintenanceSchedules,
  missions,
  statusHistory,
  vehicleDeletionEffects,
  vehicleDocuments,
  vehicles,
  workOrders,
} from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { VEHICLE_OPEN_WORK_MESSAGE } from "../../server/services/vehicle-lifecycle-service";

/**
 * Retrait d'un véhicule de la flotte (DELETE /api/vehicles/:id) et remise en service
 * (POST /api/vehicles/:id/restore).
 * - Sans aucune action enregistrée : suppression physique.
 * - Avec une action (document, plan de maintenance, OT clos...) : suppression douce, rien de
 *   saisi n'est perdu ; plans actifs et renouvellements ouverts sont désactivés et journalisés.
 * - OT ou mission encore ouverts : 409, rien ne change.
 * - Restauration : ne réactive que ce que la suppression a désactivé et qui n'a pas bougé depuis.
 */

type Captured = { eventType: string; data: any };
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];

let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician">>>;
const asAdmin = (method: string, path: string) => actors.call(method, path, { actor: "admin" });

async function vehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v;
}

async function addDocument(vehicleId: number) {
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST carte grise", type: "carte_grise", filename: "t.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/test-none.pdf" } as any)
    .returning();
  return doc;
}

async function addSchedule(vehicleId: number, isActive: boolean) {
  const [row] = await db
    .insert(maintenanceSchedules)
    .values({ vehicleId, title: `TEST plan ${isActive}`, frequency: "km", frequencyValue: 10000, isActive } as any)
    .returning();
  return row;
}

async function addRenewal(vehicleId: number, vehicleDocumentId: number, status: "pending" | "completed") {
  const [row] = await db
    .insert(documentRenewalRequests)
    .values({ vehicleId, vehicleDocumentId, documentType: "carte_grise", status } as any)
    .returning();
  return row;
}

const vehicleRow = async (id: number) => (await db.select().from(vehicles).where(eq(vehicles.id, id)))[0];
const effectsOf = (id: number) => db.select().from(vehicleDeletionEffects).where(eq(vehicleDeletionEffects.vehicleId, id));
const scheduleActive = async (id: number) =>
  (await db.select({ a: maintenanceSchedules.isActive }).from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id)))[0]?.a;
const renewalStatus = async (id: number) =>
  (await db.select({ s: documentRenewalRequests.status }).from(documentRenewalRequests).where(eq(documentRenewalRequests.id, id)))[0]?.s;

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: unknown) => {
    captured.push({ eventType, data });
  });
  actors = await startContractActors({ admin: "admin", technician: "technician" }, ids.userIds);
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (ids.vehicleIds.length > 0) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds));
    await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, ids.vehicleIds));
    await db.delete(statusHistory).where(inArray(statusHistory.vehicleId, ids.vehicleIds));
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
  }
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await actors?.close();
});

describe("DELETE /api/vehicles/:id : physique sans action, douce avec", { timeout: 60000 }, () => {
  it("sans aucune action : supprime la ligne et diffuse vehicle_deleted au personnel", async () => {
    const v = await vehicle();
    captured.length = 0;
    const res = await asAdmin("DELETE", `/api/vehicles/${v.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ mode: "hard", vehicleId: v.id });
    expect(await vehicleRow(v.id)).toBeUndefined();
    const frame = captured.find((c) => c.eventType === "vehicle_deleted");
    expect(frame?.data).toMatchObject({ vehicleId: v.id, scope: { type: "roles" } });
    expect(frame?.data.scope.roles).not.toContain("client");
  });

  it("avec un document : suppression douce, le document reste en base", async () => {
    const v = await vehicle();
    const doc = await addDocument(v.id);
    const res = await asAdmin("DELETE", `/api/vehicles/${v.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ mode: "soft", vehicleId: v.id, activity: ["documents"], deactivated: 0 });
    expect((await vehicleRow(v.id))?.deletedAt).not.toBeNull();
    expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, doc.id))).toHaveLength(1);
  });

  it("avec un plan de maintenance : désactive les plans actifs et les renouvellements ouverts, journalisés", async () => {
    const v = await vehicle();
    const doc = await addDocument(v.id);
    const active = await addSchedule(v.id, true);
    const inactive = await addSchedule(v.id, false);
    const open = await addRenewal(v.id, doc.id, "pending");
    const done = await addRenewal(v.id, doc.id, "completed");

    const res = await asAdmin("DELETE", `/api/vehicles/${v.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ mode: "soft", deactivated: 2 });
    expect(await scheduleActive(active.id)).toBe(false);
    expect(await scheduleActive(inactive.id)).toBe(false);
    expect(await renewalStatus(open.id)).toBe("rejected");
    expect(await renewalStatus(done.id)).toBe("completed");
    const effects = await effectsOf(v.id);
    expect(effects.map((e) => `${e.tableName}:${e.rowId}`).sort()).toEqual(
      [`document_renewal_requests:${open.id}`, `maintenance_schedules:${active.id}`].sort(),
    );
  });

  it("refuse un rôle non admin (403) sans rien changer", async () => {
    const v = await vehicle();
    const plan = await addSchedule(v.id, true);
    expect((await actors.call("DELETE", `/api/vehicles/${v.id}`, { actor: "technician" })).status).toBe(403);
    expect((await vehicleRow(v.id))?.deletedAt).toBeNull();
    expect(await scheduleActive(plan.id)).toBe(true);
  });
});

describe("DELETE /api/vehicles/:id : 409 tant qu'un OT ou une mission est ouvert", { timeout: 60000 }, () => {
  it("OT ouvert : 409 avec l'OT en détail, véhicule et plans intacts", async () => {
    const v = await vehicle();
    const plan = await addSchedule(v.id, true);
    const [wo] = await db.insert(workOrders).values({ vehicleId: v.id, title: "TEST OT ouvert", status: "in_progress" } as any).returning();
    const res = await asAdmin("DELETE", `/api/vehicles/${v.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(VEHICLE_OPEN_WORK_MESSAGE);
    expect(res.body.openWorkOrders?.map((w: any) => w.id)).toEqual([wo.id]);
    expect((await vehicleRow(v.id))?.deletedAt).toBeNull();
    expect(await scheduleActive(plan.id)).toBe(true);
    expect(await effectsOf(v.id)).toHaveLength(0);
  });

  it("mission ouverte affectée au véhicule : 409 avec la mission en détail", async () => {
    const v = await vehicle();
    const [driver] = await db.insert(drivers).values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORMÉ" } as any).returning();
    driverIds.push(driver.id);
    const [mission] = await db
      .insert(missions)
      .values({ orderNumber: uniqueTestToken("ord"), pickupAddress: "Douala", deliveryAddress: "Yaoundé", status: "planned", createdBy: actors.userIdOf("admin") } as any)
      .returning();
    missionIds.push(mission.id);
    await db.insert(assignments).values({ missionId: mission.id, vehicleId: v.id, driverId: driver.id, status: "pending" } as any);
    const res = await asAdmin("DELETE", `/api/vehicles/${v.id}`);
    expect(res.status).toBe(409);
    expect(res.body.openMissions?.map((m: any) => m.id)).toEqual([mission.id]);
    expect((await vehicleRow(v.id))?.deletedAt).toBeNull();
  });
});

describe("POST /api/vehicles/:id/restore : restauration symétrique et idempotente", { timeout: 60000 }, () => {
  it("ne réactive que ce que la suppression a désactivé et qui n'a pas changé depuis", async () => {
    const v = await vehicle();
    const doc = await addDocument(v.id);
    const active = await addSchedule(v.id, true);
    const inactive = await addSchedule(v.id, false);
    const open = await addRenewal(v.id, doc.id, "pending");
    const reopened = await addRenewal(v.id, doc.id, "pending");
    expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);

    // Modifié par quelqu'un pendant le retrait : la restauration ne l'écrase pas.
    await db.update(documentRenewalRequests).set({ status: "completed" }).where(eq(documentRenewalRequests.id, reopened.id));

    captured.length = 0;
    const res = await asAdmin("POST", `/api/vehicles/${v.id}/restore`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ vehicleId: v.id, restored: true, reactivated: 2 });
    expect((await vehicleRow(v.id))?.deletedAt).toBeNull();
    expect(await scheduleActive(active.id)).toBe(true);
    expect(await scheduleActive(inactive.id)).toBe(false);
    expect(await renewalStatus(open.id)).toBe("pending");
    expect(await renewalStatus(reopened.id)).toBe("completed");
    expect(await effectsOf(v.id)).toHaveLength(0);
    expect(captured.find((c) => c.eventType === "vehicle_restored")?.data).toMatchObject({ vehicleId: v.id });

    const notes = await db.select({ n: statusHistory.notes }).from(statusHistory).where(eq(statusHistory.vehicleId, v.id));
    expect(notes.map((r) => r.n)).toEqual(expect.arrayContaining(["Retiré de la flotte (suppression douce)", "Remis dans la flotte (restauration)"]));
  });

  it("un second appel sur un véhicule actif ne change rien (200, restored: false, aucune trame)", async () => {
    const v = await vehicle();
    const plan = await addSchedule(v.id, false);
    captured.length = 0;
    const res = await asAdmin("POST", `/api/vehicles/${v.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ vehicleId: v.id, restored: false, reactivated: 0 });
    expect(await scheduleActive(plan.id)).toBe(false);
    expect(captured.filter((c) => c.eventType === "vehicle_restored")).toHaveLength(0);
  });

  it("supprimer, restaurer, supprimer : le journal est rejoué une seule fois par cycle", async () => {
    const v = await vehicle();
    const plan = await addSchedule(v.id, true);
    for (let cycle = 0; cycle < 2; cycle++) {
      expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);
      expect(await effectsOf(v.id)).toHaveLength(1);
      expect((await asAdmin("POST", `/api/vehicles/${v.id}/restore`)).status).toBe(200);
      expect(await scheduleActive(plan.id)).toBe(true);
    }
  });

  it("refuse un rôle non admin (403) et répond 404 à un véhicule inconnu", async () => {
    const v = await vehicle();
    await addDocument(v.id);
    expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);
    expect((await actors.call("POST", `/api/vehicles/${v.id}/restore`, { actor: "technician" })).status).toBe(403);
    expect((await vehicleRow(v.id))?.deletedAt).not.toBeNull();
    expect((await asAdmin("POST", "/api/vehicles/2147483000/restore")).status).toBe(404);
  });
});

