import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { FuelService } from "../../server/services/fuel-service";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { fuelRecords } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * Suppression d'un plein (DELETE /api/fuel-records/:id) :
 *  - plein qui a mouvementé la carte : réservé à admin, logistics, secretary ; suppression douce
 *    (deleted_at, deleted_by), le solde est rétabli ; refusé au chef d'atelier (403, rien d'écrit) ;
 *  - plein physique (aucun mouvement) : garde historique, chef d'atelier et admin, suppression définitive ;
 *  - une ligne supprimée est introuvable (404), ne se modifie plus, et sort des listes et des sommes.
 */
const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  secretary: "secretary",
  workshop_manager: "workshop_manager",
  technician: "technician",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

async function vehicleId() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v.id;
}

/** Plein qui a mouvementé la carte (débit non nul). */
async function movedRecord(vId: number) {
  const record = await createTestFuelRecord({ vehicleId: vId, debitAmount: "1234.00", cost: "1234.00", quantity: 3 });
  ids.fuelRecordIds.push(record.id);
  return record;
}

/** Plein physique : carte intacte (aucun débit ni crédit). */
async function physicalRecord(vId: number) {
  const record = await createTestFuelRecord({ vehicleId: vId, debitAmount: "0", creditAmount: "0", cost: "500.00", quantity: 1 });
  ids.fuelRecordIds.push(record.id);
  return record;
}

const rowOf = async (id: number) => (await db.select().from(fuelRecords).where(eq(fuelRecords.id, id)))[0];
const del = (id: number, actor: Actor) => session.call("DELETE", `/api/fuel-records/${id}`, { actor });

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("DELETE /api/fuel-records/:id : plein qui a mouvementé la carte", { timeout: 120000 }, () => {
  it.each(["admin", "logistics", "secretary"] as const)("%s : 204, suppression douce tracée, solde rétabli", async (actor) => {
    const record = await movedRecord(await vehicleId());
    const before = (await fuelCardService.getCurrentBalance()).balance;

    const res = await del(record.id, actor);
    expect(res.status).toBe(204);

    const row = await rowOf(record.id);
    expect(row).toBeDefined();
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.deletedBy).toBe(session.userIdOf(actor));
    // Le débit supprimé ne compte plus : le solde remonte de son montant.
    const after = (await fuelCardService.getCurrentBalance()).balance;
    expect(after - before).toBeCloseTo(1234, 2);
  });

  it("chef d'atelier : 403, ligne intacte, solde inchangé", async () => {
    const record = await movedRecord(await vehicleId());
    const before = (await fuelCardService.getCurrentBalance()).balance;

    const res = await del(record.id, "workshop_manager");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });

    const row = await rowOf(record.id);
    expect(row.deletedAt).toBeNull();
    expect(row.deletedBy).toBeNull();
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(before, 2);
  });

  it("technicien : 403 à la déclaration de la route, ligne intacte", async () => {
    const record = await movedRecord(await vehicleId());
    expect((await del(record.id, "technician")).status).toBe(403);
    expect((await rowOf(record.id)).deletedAt).toBeNull();
  });
});

describe("DELETE /api/fuel-records/:id : plein physique (aucun mouvement de carte)", { timeout: 120000 }, () => {
  it("chef d'atelier : 204, ligne supprimée", async () => {
    const record = await physicalRecord(await vehicleId());
    expect((await del(record.id, "workshop_manager")).status).toBe(204);
    expect(await rowOf(record.id)).toBeUndefined();
  });

  it("garde historique conservée : logistics -> 403, ligne conservée", async () => {
    const record = await physicalRecord(await vehicleId());
    expect((await del(record.id, "logistics")).status).toBe(403);
    expect(await rowOf(record.id)).toBeDefined();
  });
});

describe("ligne supprimée (suppression douce)", { timeout: 120000 }, () => {
  it("seconde suppression : 404, deleted_by de la première conservé", async () => {
    const record = await movedRecord(await vehicleId());
    expect((await del(record.id, "admin")).status).toBe(204);
    const second = await del(record.id, "logistics");
    expect(second.status).toBe(404);
    expect((await rowOf(record.id)).deletedBy).toBe(session.userIdOf("admin"));
  });

  it("PATCH d'une ligne supprimée : 404, rien d'écrit", async () => {
    const record = await movedRecord(await vehicleId());
    expect((await del(record.id, "admin")).status).toBe(204);
    const patch = await session.call("PATCH", `/api/fuel-records/${record.id}`, { actor: "admin", body: { notes: "TEST-apres-suppression" } });
    expect(patch.status).toBe(404);
    expect((await rowOf(record.id)).notes).toBe(record.notes);
  });

  it("absente des listes et des sommes", async () => {
    const vId = await vehicleId();
    const kept = await movedRecord(vId);
    const removed = await movedRecord(vId);
    const statsBefore = await fuelCardService.getCurrentBalance();
    expect((await del(removed.id, "admin")).status).toBe(204);

    const byVehicle = await session.call("GET", `/api/fuel-records?vehicleId=${vId}`, { actor: "admin" });
    expect(byVehicle.status).toBe(200);
    expect(byVehicle.body.map((r: any) => r.id)).toEqual([kept.id]);

    const perVehicle = await session.call("GET", `/api/fuel-records/vehicle/${vId}`, { actor: "admin" });
    expect(perVehicle.body.map((r: any) => r.id)).toEqual([kept.id]);

    const statsAfter = await fuelCardService.getCurrentBalance();
    expect(statsAfter.totalDebits).toBeCloseTo(statsBefore.totalDebits - 1234, 2);
  });

  it("absente de /api/fuel-records/statistics et de /consumption-history (lecteurs de storage)", async () => {
    const vId = await vehicleId();
    const today = new Date().toISOString().slice(0, 10);
    const kept = await createTestFuelRecord({ vehicleId: vId, date: today, debitAmount: "1234.00", cost: "1234.00", quantity: 3 });
    const removed = await createTestFuelRecord({ vehicleId: vId, date: today, debitAmount: "1234.00", cost: "1234.00", quantity: 3 });
    ids.fuelRecordIds.push(kept.id, removed.id);
    expect((await del(removed.id, "admin")).status).toBe(204);

    const stats = await session.call("GET", "/api/fuel-records/statistics?period=week", { actor: "admin" });
    expect(stats.status).toBe(200);
    const mine = stats.body.vehicleStats.find((v: any) => v.vehicleId === vId);
    expect(mine).toMatchObject({ recordCount: 1, cost: 1234 });

    const history = await session.call("GET", `/api/fuel-records/consumption-history?period=week&vehicleId=${vId}`, { actor: "admin" });
    expect(history.status).toBe(200);
    expect(history.body.reduce((n: number, row: any) => n + row.count, 0)).toBe(1);
    expect(history.body.reduce((n: number, row: any) => n + row.cost, 0)).toBe(1234);
  });

  it("updateFuelRecord (appelé par le PATCH après sa lecture) ne touche aucune ligne supprimée", async () => {
    const record = await movedRecord(await vehicleId());
    expect((await del(record.id, "admin")).status).toBe(204);
    // Course : la route a lu la ligne vivante, une suppression est passée avant l'écriture. Le service
    // renvoie undefined, la route lève alors 404 (et non plus 500).
    await expect(new FuelService().updateFuelRecord(record.id, { notes: "TEST-course" })).resolves.toBeUndefined();
    expect((await rowOf(record.id)).notes).not.toBe("TEST-course");
  });
});
