import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../server/db";
import { VEHICLE_LIFECYCLE_SQL } from "../../server/init-database";
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
import { VEHICLE_ARCHIVE_CONFLICT_MESSAGE, VEHICLE_OPEN_WORK_MESSAGE } from "../../server/services/vehicle-lifecycle-service";

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

let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician" | "owner" | "stranger">>>;
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
  actors = await startContractActors({ admin: "admin", technician: "technician", owner: "client", stranger: "client" }, ids.userIds);
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
    const row = await vehicleRow(v.id);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedBy).toBe(actors.userIdOf("admin"));
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
    expect(await vehicleRow(v.id)).toMatchObject({ deletedAt: null, deletedBy: null });
    expect(await scheduleActive(active.id)).toBe(true);
    expect(await scheduleActive(inactive.id)).toBe(false);
    expect(await renewalStatus(open.id)).toBe("pending");
    expect(await renewalStatus(reopened.id)).toBe("completed");
    expect(await effectsOf(v.id)).toHaveLength(0);
    expect(captured.find((c) => c.eventType === "vehicle_restored")?.data).toMatchObject({ vehicleId: v.id });

    const notes = await db.select({ n: statusHistory.notes }).from(statusHistory).where(eq(statusHistory.vehicleId, v.id));
    expect(notes.map((r) => r.n)).toEqual(expect.arrayContaining(["Retiré de la flotte (suppression douce)", "Remis dans la flotte (restauration)"]));
  });

  it("renouvellement rejeté à la main pendant le retrait : même valeur, mais pas rouvert (updated_at a bougé)", async () => {
    const v = await vehicle();
    const doc = await addDocument(v.id);
    const byDeletion = await addRenewal(v.id, doc.id, "pending");
    const byHand = await addRenewal(v.id, doc.id, "pending");
    expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);
    expect(await renewalStatus(byHand.id)).toBe("rejected");
    const stamped = await db.execute(sql`SELECT count(*)::int AS n FROM vehicle_deletion_effects WHERE vehicle_id = ${v.id} AND applied_stamp IS NOT NULL`);
    expect((stamped.rows[0] as { n: number }).n).toBe(2);

    // Rejet confirmé à la main pendant le retrait : tout écrivain renouvelle updated_at.
    await db.execute(sql`UPDATE document_renewal_requests SET status = 'rejected', updated_at = now() + interval '1 second' WHERE id = ${byHand.id}`);

    const res = await asAdmin("POST", `/api/vehicles/${v.id}/restore`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ vehicleId: v.id, restored: true, reactivated: 1 });
    expect(await renewalStatus(byDeletion.id)).toBe("pending");
    expect(await renewalStatus(byHand.id)).toBe("rejected");
  });

  it("plan désactivé à la main pendant le retrait : même valeur, mais pas réactivé (le déclencheur renouvelle updated_at)", async () => {
    const v = await vehicle();
    const byDeletion = await addSchedule(v.id, true);
    const byHand = await addSchedule(v.id, true);
    expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);
    expect(await scheduleActive(byHand.id)).toBe(false);

    // Écrivain qui ne touche que is_active (SQL brut : l'ORM ne prouve rien, seul le déclencheur renouvelle updated_at).
    await db.execute(sql`UPDATE maintenance_schedules SET is_active = false WHERE id = ${byHand.id}`);

    const res = await asAdmin("POST", `/api/vehicles/${v.id}/restore`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ vehicleId: v.id, restored: true, reactivated: 1 });
    expect(await scheduleActive(byDeletion.id)).toBe(true);
    expect(await scheduleActive(byHand.id)).toBe(false);
  });

  it("SQL du cycle de vie rejoué : plan antérieur laissé à NULL, déclencheur unique", async () => {
    const v = await vehicle();
    const legacy = await addSchedule(v.id, true);
    // Plan antérieur à la colonne : NULL, posé hors déclencheur (qui ne joue que sur UPDATE).
    await db.execute(sql`ALTER TABLE maintenance_schedules DISABLE TRIGGER trg_maintenance_schedules_touch`);
    try {
      await db.execute(sql`UPDATE maintenance_schedules SET updated_at = NULL WHERE id = ${legacy.id}`);
    } finally {
      await db.execute(sql`ALTER TABLE maintenance_schedules ENABLE TRIGGER trg_maintenance_schedules_touch`);
    }
    await pool.query(VEHICLE_LIFECYCLE_SQL);
    await pool.query(VEHICLE_LIFECYCLE_SQL);
    const [row] = await db.select({ u: maintenanceSchedules.updatedAt }).from(maintenanceSchedules).where(eq(maintenanceSchedules.id, legacy.id));
    expect(row.u).toBeNull();
    const triggers = await db.execute(sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'trg_maintenance_schedules_touch' AND NOT tgisinternal`);
    expect((triggers.rows[0] as { n: number }).n).toBe(1);
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

  it("GET /api/vehicles/archived (écran Véhicules retirés) suit le retrait puis la restauration", async () => {
    const v = await vehicle();
    await addDocument(v.id);
    const listed = async () =>
      ((await asAdmin("GET", "/api/vehicles/archived")).body as Array<{ id: number }>).find((row) => row.id === v.id);
    expect(await listed()).toBeUndefined();
    expect((await asAdmin("DELETE", `/api/vehicles/${v.id}`)).status).toBe(200);
    expect(await listed()).toMatchObject({ id: v.id, registration_number: v.registrationNumber, archived_at: expect.any(String) });
    expect((await actors.call("GET", "/api/vehicles/archived", { actor: "technician" })).status).toBe(403);
    expect((await asAdmin("POST", `/api/vehicles/${v.id}/restore`)).status).toBe(200);
    expect(await listed()).toBeUndefined();
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

describe("cloison client : ni retrait ni remise en service, même de son propre véhicule", { timeout: 60000 }, () => {
  for (const actor of ["owner", "stranger"] as const) {
    it(`client ${actor === "owner" ? "propriétaire" : "tiers"} : 403 sur DELETE et restore, véhicule intact, aucune trame`, async () => {
      const own = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
      ids.vehicleIds.push(own.id);
      const plan = await addSchedule(own.id, true);
      captured.length = 0;

      expect((await actors.call("DELETE", `/api/vehicles/${own.id}`, { actor })).status).toBe(403);
      expect((await vehicleRow(own.id))?.deletedAt).toBeNull();
      expect(await scheduleActive(plan.id)).toBe(true);

      await addDocument(own.id);
      expect((await asAdmin("DELETE", `/api/vehicles/${own.id}`)).status).toBe(200);
      captured.length = 0;
      expect((await actors.call("POST", `/api/vehicles/${own.id}/restore`, { actor })).status).toBe(403);
      expect((await vehicleRow(own.id))?.deletedAt).not.toBeNull();
      expect(await scheduleActive(plan.id)).toBe(false);
      expect(await effectsOf(own.id)).toHaveLength(1);

      expect(captured.filter((c) => c.eventType === "vehicle_deleted" || c.eventType === "vehicle_restored")).toHaveLength(0);
    });
  }
});

describe("POST /api/vehicles/:id/restore : repli sur l'ancienne table vehicle_archived", { timeout: 60000 }, () => {
  // Aucune migration ne crée vehicle_archived : le test la crée, puis la supprime.
  const archivedId = 2_100_000_000 + Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS vehicle_archived (
      original_vehicle_id integer NOT NULL, registration_number text NOT NULL, brand text NOT NULL,
      model text NOT NULL, year integer NOT NULL, notes text, archived_at timestamp DEFAULT now())`);
  });

  afterAll(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS vehicle_archived`);
    await db.delete(statusHistory).where(eq(statusHistory.vehicleId, archivedId));
    await db.delete(vehicles).where(eq(vehicles.id, archivedId));
  });

  it("table présente, fiche absente : 404 comme sans table", async () => {
    expect((await asAdmin("POST", `/api/vehicles/${archivedId}/restore`)).status).toBe(404);
  });

  it("immatriculation reprise par un véhicule actif : 409, l'archive est conservée", async () => {
    const v = await vehicle();
    await db.execute(sql`INSERT INTO vehicle_archived (original_vehicle_id, registration_number, brand, model, year)
      VALUES (${archivedId}, ${v.registrationNumber}, 'TEST', 'Archive', 2015)`);
    const res = await asAdmin("POST", `/api/vehicles/${archivedId}/restore`);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toBe(VEHICLE_ARCHIVE_CONFLICT_MESSAGE);
    expect(await vehicleRow(archivedId)).toBeUndefined();
    await db.execute(sql`DELETE FROM vehicle_archived WHERE original_vehicle_id = ${archivedId}`);
  });

  it("fiche archivée : restaurée sous son identifiant d'origine, opérationnelle, archive vidée", async () => {
    const registration = uniqueTestToken("ARC").slice(0, 40);
    await db.execute(sql`INSERT INTO vehicle_archived (original_vehicle_id, registration_number, brand, model, year)
      VALUES (${archivedId}, ${registration}, 'TEST', 'Archive', 2015)`);
    captured.length = 0;
    const res = await asAdmin("POST", `/api/vehicles/${archivedId}/restore`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toEqual({ vehicleId: archivedId, restored: true, reactivated: 0, source: "archive" });
    expect(await vehicleRow(archivedId)).toMatchObject({ registrationNumber: registration, status: "operational", mileage: 0, deletedAt: null });
    const left = await db.execute(sql`SELECT 1 FROM vehicle_archived WHERE original_vehicle_id = ${archivedId}`);
    expect(left.rows).toHaveLength(0);
    expect(captured.find((c) => c.eventType === "vehicle_restored")?.data).toMatchObject({ vehicleId: archivedId });
    // Second appel : véhicule actif, rien ne change.
    expect((await asAdmin("POST", `/api/vehicles/${archivedId}/restore`)).body.result).toEqual({ vehicleId: archivedId, restored: false, reactivated: 0 });
  });
});
