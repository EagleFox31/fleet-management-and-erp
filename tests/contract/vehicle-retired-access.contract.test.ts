import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicles } from "../../shared/schema";
import { VEHICLE_RETIRED_EDIT_MESSAGE } from "../../server/lib/vehicle-retired";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/**
 * Véhicule retiré de la flotte (deleted_at renseigné) :
 * - détail : le personnel le lit (deletedAt renseigné), un client reçoit 403 comme pour un véhicule absent ;
 * - PATCH : 409 tant qu'il n'est pas restauré ; deletedAt et deletedBy ne s'écrivent jamais par PATCH ;
 * - /api/vehicles/check/:reg : pour le personnel, l'immatriculation reste réservée et la réponse le dit (retired) ;
 *   un client reçoit exists: false, comme pour une plaque inconnue.
 */
const ids = createIdBag();
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician" | "owner">>>;

beforeAll(async () => {
  actors = await startContractActors({ admin: "admin", technician: "technician", owner: "client" }, ids.userIds);
}, 180000);

afterAll(async () => {
  await cleanupCreated(ids);
  await actors?.close();
});

async function retiredVehicle() {
  const v = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  ids.vehicleIds.push(v.id);
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, v.id));
  return v;
}

const row = async (id: number) => (await db.select().from(vehicles).where(eq(vehicles.id, id)))[0];

describe("véhicule retiré : détail", { timeout: 60000 }, () => {
  it.each(["admin", "technician"] as const)("%s le lit par id et par immatriculation, deletedAt renseigné", async (actor) => {
    const v = await retiredVehicle();
    for (const key of [String(v.id), v.registrationNumber]) {
      const res = await actors.call("GET", `/api/vehicles/${encodeURIComponent(key)}`, { actor });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ id: v.id });
      expect(res.body.deletedAt).not.toBeNull();
    }
  });

  it("le client propriétaire reçoit 403, même message qu'un véhicule absent", async () => {
    const v = await retiredVehicle();
    const missing = await actors.call("GET", "/api/vehicles/2147483000", { actor: "owner" });
    expect(missing.status).toBe(403);
    for (const key of [String(v.id), v.registrationNumber]) {
      const res = await actors.call("GET", `/api/vehicles/${encodeURIComponent(key)}`, { actor: "owner" });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(missing.body.message);
    }
  });

  it("témoin : le même client lit son véhicule actif (200)", async () => {
    const v = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
    ids.vehicleIds.push(v.id);
    expect((await actors.call("GET", `/api/vehicles/${v.id}`, { actor: "owner" })).status).toBe(200);
  });
});

describe("véhicule retiré : modification", { timeout: 60000 }, () => {
  it("PATCH : 409 lisible, véhicule inchangé", async () => {
    const v = await retiredVehicle();
    const res = await actors.call("PATCH", `/api/vehicles/${v.id}`, { actor: "admin", body: { brand: "TEST modifiée" } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toBe(VEHICLE_RETIRED_EDIT_MESSAGE);
    expect((await row(v.id))?.brand).toBe(v.brand);
  });

  it("PATCH d'un véhicule actif : deletedAt et deletedBy du corps sont ignorés", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const res = await actors.call("PATCH", `/api/vehicles/${v.id}`, {
      actor: "admin",
      body: { notes: "TEST note", deletedAt: new Date().toISOString(), deletedBy: actors.userIdOf("admin") },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await row(v.id)).toMatchObject({ notes: "TEST note", deletedAt: null, deletedBy: null });
  });
});

describe("véhicule retiré : immatriculation réservée", { timeout: 60000 }, () => {
  it("check : exists et retired pour le personnel", async () => {
    const v = await retiredVehicle();
    for (const actor of ["admin", "technician"] as const) {
      const res = await actors.call("GET", `/api/vehicles/check/${encodeURIComponent(v.registrationNumber)}`, { actor });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: true, id: v.id, registrationNumber: v.registrationNumber, retired: true });
    }
  });

  it("check : le client propriétaire reçoit exists: false, comme pour une plaque inconnue", async () => {
    const v = await retiredVehicle();
    const res = await actors.call("GET", `/api/vehicles/check/${encodeURIComponent(v.registrationNumber)}`, { actor: "owner" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });

  it("témoin : le client propriétaire voit son véhicule actif au check", async () => {
    const v = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
    ids.vehicleIds.push(v.id);
    const res = await actors.call("GET", `/api/vehicles/check/${encodeURIComponent(v.registrationNumber)}`, { actor: "owner" });
    expect(res.body).toMatchObject({ exists: true, id: v.id, retired: false });
  });

  it("témoin : un véhicule actif répond retired: false", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const res = await actors.call("GET", `/api/vehicles/check/${encodeURIComponent(v.registrationNumber)}`, { actor: "admin" });
    expect(res.body).toMatchObject({ exists: true, id: v.id, retired: false });
  });
});
