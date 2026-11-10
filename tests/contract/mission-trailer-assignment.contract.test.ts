import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import {
  TRAILER_ALREADY_HITCHED_MESSAGE,
  TRAILER_IS_TRUCK_MESSAGE,
  TRAILER_WRONG_TYPE_MESSAGE,
  TRUCK_IS_TRAILER_MESSAGE,
} from "../../server/services/trailer-assignment";
import { MISSION_OPERATIONS_PATH } from "../../shared/contracts/mission-operations";
import { assignments, drivers, missionOperations, missions, vehicles } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Remorque attelée à une affectation (`assignments.trailer_id`) :
 *  - type remorque / semi_remorque vérifié côté serveur (400 lisible), jamais le camion lui-même ;
 *  - une remorque sur un seul attelage actif (409 lisible, index partiel `uq_assignments_trailer_active`) ;
 *  - le comptable et le lecteur n'écrivent pas (403) ;
 *  - la lecture de mission porte `assignment.trailer` ; l'événement `mission_updated` porte `trailerId` ;
 *  - O1 : la remorque de l'affectation active préremplit `trailerVehicleId`, sans écraser une saisie.
 */
process.env.FEATURE_FLAGS = "operations-tracking=on";

const ACTORS = { admin: "admin", logistics: "logistics", accountant: "accountant", viewer: "viewer" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const previousBroadcast = (global as any).broadcastUpdate;
const frames: { eventType: string; data: any }[] = [];
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

async function vehicle(vehicleType: "porteur" | "remorque" = "porteur") {
  const v = await createTestVehicle({ vehicleType });
  ids.vehicleIds.push(v.id);
  return v.id;
}
const trailer = () => vehicle("remorque");

async function driver() {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(d.id);
  return d.id;
}

async function mission(status = "planned") {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("TRL"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any)
    .returning();
  missionIds.push(m.id);
  return m.id;
}

const add = (actor: Actor, missionId: number, body: unknown) => session.call("POST", `/api/missions/${missionId}/assignments`, { actor, body });
const rowsOf = async (missionId: number) => db.select().from(assignments).where(eq(assignments.missionId, missionId));
const create = async (actor: Actor, assignment: unknown) => {
  const res = await session.call("POST", "/api/missions", {
    actor,
    body: { orderNumber: uniqueTestToken("TRL"), missionType: "delivery", pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "planned", assignment },
  });
  if (res.status === 201) missionIds.push(res.body.id);
  return res;
};

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: any) => frames.push({ eventType, data }));
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (missionIds.length > 0) {
    await db.delete(missionOperations).where(inArray(missionOperations.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("remorque d'affectation", { timeout: 180000 }, () => {
  it("logistique attelle une remorque : 201, la lecture de mission la porte, l'événement aussi", async () => {
    const missionId = await mission();
    const trailerId = await trailer();
    const res = await add("logistics", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ missionId, trailerId });

    const detail = await session.call("GET", `/api/missions/${missionId}`, { actor: "admin" });
    expect(detail.status).toBe(200);
    expect(detail.body.assignment).toMatchObject({ trailerId, trailer: { id: trailerId } });

    const frame = frames.find((f) => f.eventType === "mission_updated" && f.data?.entityId === missionId);
    expect(frame?.data?.payload).toMatchObject({ trailerId });
  });

  it("sans remorque : 201, trailerId nul", async () => {
    const missionId = await mission();
    const res = await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.trailerId).toBeNull();
  });

  it("un camion comme remorque : 400 lisible, rien d'écrit", async () => {
    const missionId = await mission();
    const res = await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId: await vehicle("porteur") });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe(TRAILER_WRONG_TYPE_MESSAGE);
    expect(await rowsOf(missionId)).toHaveLength(0);
  });

  it("la remorque ne peut pas être le camion : 400 lisible", async () => {
    const missionId = await mission();
    const truck = await vehicle();
    const res = await add("admin", missionId, { driverId: await driver(), vehicleId: truck, trailerId: truck });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe(TRAILER_IS_TRUCK_MESSAGE);
    expect(await rowsOf(missionId)).toHaveLength(0);
  });

  it("remorque déjà attelée sur une affectation active : 409 lisible ; libérée (annulée), elle se rattelle", async () => {
    const trailerId = await trailer();
    const first = await mission();
    expect((await add("admin", first, { driverId: await driver(), vehicleId: await vehicle(), trailerId })).status).toBe(201);

    const second = await mission();
    const res = await add("admin", second, { driverId: await driver(), vehicleId: await vehicle(), trailerId });
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe(TRAILER_ALREADY_HITCHED_MESSAGE);
    expect(await rowsOf(second)).toHaveLength(0);

    await db.update(assignments).set({ status: "cancelled" }).where(eq(assignments.missionId, first));
    expect((await add("admin", second, { driverId: await driver(), vehicleId: await vehicle(), trailerId })).status).toBe(201);
  });

  it("deux attelages simultanés de la même remorque : un 201, un 409 (verrou puis index partiel)", async () => {
    const trailerId = await trailer();
    const [a, b] = [await mission(), await mission()];
    const [da, dbId, va, vb] = [await driver(), await driver(), await vehicle(), await vehicle()];
    const results = await Promise.all([
      add("admin", a, { driverId: da, vehicleId: va, trailerId }),
      add("logistics", b, { driverId: dbId, vehicleId: vb, trailerId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("PATCH de mission : la remorque se change et se retire ; même remorque conservée sur sa propre ligne", async () => {
    const missionId = await mission();
    const [trailerA, trailerB, truck, driverId] = [await trailer(), await trailer(), await vehicle(), await driver()];
    expect((await add("admin", missionId, { driverId, vehicleId: truck, trailerId: trailerA })).status).toBe(201);

    const keep = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "admin", body: { assignment: { vehicleId: truck, driverId, trailerId: trailerA } } });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    const change = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "admin", body: { assignment: { vehicleId: truck, driverId, trailerId: trailerB } } });
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect((await rowsOf(missionId)).map((r) => r.trailerId)).toEqual([trailerB]);
    const remove = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "admin", body: { assignment: { vehicleId: truck, driverId, trailerId: null } } });
    expect(remove.status, JSON.stringify(remove.body)).toBe(200);
    expect((await rowsOf(missionId)).map((r) => r.trailerId)).toEqual([null]);
  });

  it.each(["accountant", "viewer"] as const)("%s : 403, rien d'écrit", async (actor) => {
    const missionId = await mission();
    const res = await add(actor, missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId: await trailer() });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await rowsOf(missionId)).toHaveLength(0);
  });

  it("création de mission avec remorque : 201, l'affectation porte la remorque", async () => {
    const trailerId = await trailer();
    const res = await create("logistics", { vehicleId: await vehicle(), driverId: await driver(), trailerId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await rowsOf(res.body.id))[0]).toMatchObject({ trailerId });
  });

  it.each([["abc"], [1.5], [2147483648], [true]])("création de mission, trailerId %j : 400, jamais 500", async (trailerId) => {
    const res = await create("logistics", { vehicleId: await vehicle(), driverId: await driver(), trailerId });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it("création de mission et ajout d'affectation simultanés sur la même remorque : un 201, un 409, jamais d'interblocage", async () => {
    const [truck, trailerId, existing] = [await vehicle(), await trailer(), await mission()];
    const [d1, d2] = [await driver(), await driver()];
    const results = await Promise.all([
      create("admin", { vehicleId: truck, driverId: d1, trailerId }),
      add("logistics", existing, { vehicleId: truck, driverId: d2, trailerId }),
    ]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
  });

  it("O1 : la remorque de l'affectation active préremplit le suivi, sans écraser une saisie", async () => {
    const missionId = await mission();
    const [trailerId, other] = [await trailer(), await trailer()];
    expect((await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId })).status).toBe(201);

    const list = await session.call("GET", MISSION_OPERATIONS_PATH, { actor: "admin" });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.rows.find((r: any) => r.missionId === missionId)).toMatchObject({ trailerVehicleId: trailerId });

    const touched = await session.call("PUT", `${MISSION_OPERATIONS_PATH}/${missionId}`, { actor: "admin", body: { sector: "Nord" } });
    expect(touched.status, JSON.stringify(touched.body)).toBe(200);
    expect(touched.body.trailerVehicleId).toBe(trailerId);

    const explicit = await session.call("PUT", `${MISSION_OPERATIONS_PATH}/${missionId}`, { actor: "admin", body: { trailerVehicleId: other } });
    expect(explicit.status).toBe(200);
    expect(explicit.body.trailerVehicleId).toBe(other);
    const again = await session.call("PUT", `${MISSION_OPERATIONS_PATH}/${missionId}`, { actor: "admin", body: { sector: "Sud" } });
    expect(again.body.trailerVehicleId).toBe(other);
    const list2 = await session.call("GET", MISSION_OPERATIONS_PATH, { actor: "admin" });
    expect(list2.body.rows.find((r: any) => r.missionId === missionId)).toMatchObject({ trailerVehicleId: other });
  });

  it("O1 : la remorque reste préremplie une fois l'affectation terminée", async () => {
    const missionId = await mission();
    const trailerId = await trailer();
    expect((await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId })).status).toBe(201);
    await db.update(assignments).set({ status: "completed" }).where(eq(assignments.missionId, missionId));
    await db.update(missions).set({ status: "completed" } as any).where(eq(missions.id, missionId));

    const list = await session.call("GET", MISSION_OPERATIONS_PATH, { actor: "admin" });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.rows.find((r: any) => r.missionId === missionId)).toMatchObject({ trailerVehicleId: trailerId });
  });

  it("une remorque comme camion : 400 lisible sur les trois routes, rien d'écrit", async () => {
    const asTruck = await trailer();
    const added = await mission();
    const viaAdd = await add("admin", added, { driverId: await driver(), vehicleId: asTruck });
    expect(apiErrorProblems(viaAdd.status, viaAdd.body, 400, undefined, viaAdd.headers.get("x-request-id"))).toEqual([]);
    expect(viaAdd.body.message).toBe(TRUCK_IS_TRAILER_MESSAGE);
    expect(await rowsOf(added)).toHaveLength(0);

    const viaCreate = await create("admin", { vehicleId: asTruck, driverId: await driver() });
    expect(viaCreate.status, JSON.stringify(viaCreate.body)).toBe(400);
    expect(viaCreate.body.message).toBe(TRUCK_IS_TRAILER_MESSAGE);

    const patched = await mission();
    const viaPatch = await session.call("PATCH", `/api/missions/${patched}`, { actor: "admin", body: { assignment: { vehicleId: asTruck, driverId: await driver() } } });
    expect(viaPatch.status, JSON.stringify(viaPatch.body)).toBe(400);
    expect(viaPatch.body.message).toBe(TRUCK_IS_TRAILER_MESSAGE);
    expect(await rowsOf(patched)).toHaveLength(0);
  });

  it.each([
    ["en maintenance", { status: "maintenance" }],
    ["assurance expirée", { insuranceExpiry: "2020-01-01" }],
  ])("remorque inéligible (%s) : 400 lisible qui la nomme, rien d'écrit", async (_label, patch) => {
    const trailerId = await trailer();
    await db.update(vehicles).set(patch as any).where(eq(vehicles.id, trailerId));
    const [{ registrationNumber }] = await db.select({ registrationNumber: vehicles.registrationNumber }).from(vehicles).where(eq(vehicles.id, trailerId));
    const missionId = await mission();
    const res = await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toContain(registrationNumber);
    expect(await rowsOf(missionId)).toHaveLength(0);
  });

  it("donnée ancienne : une remorque roulant comme camion sur une affectation active ne s'attelle pas ailleurs (409)", async () => {
    const trailerId = await trailer();
    const legacy = await mission();
    await db.insert(assignments).values({ missionId: legacy, vehicleId: trailerId, driverId: await driver(), status: "accepted" } as any);
    const missionId = await mission();
    const res = await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId });
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe(TRAILER_ALREADY_HITCHED_MESSAGE);
  });

  it("suppression d'une remorque attelée sur une mission ouverte : 409, le véhicule reste actif", async () => {
    const missionId = await mission();
    const trailerId = await trailer();
    expect((await add("admin", missionId, { driverId: await driver(), vehicleId: await vehicle(), trailerId })).status).toBe(201);
    const res = await session.call("DELETE", `/api/vehicles/${trailerId}`, { actor: "admin" });
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    const [row] = await db.select({ deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, trailerId));
    expect(row.deletedAt).toBeNull();
  });

  it("changement de type d'un véhicule attelé : 409 dans les deux sens, type inchangé ; libre hors affectation active", async () => {
    const missionId = await mission();
    const [trailerId, truck] = [await trailer(), await vehicle()];
    expect((await add("admin", missionId, { driverId: await driver(), vehicleId: truck, trailerId })).status).toBe(201);
    const typeOf = async (id: number) => (await db.select({ t: vehicles.vehicleType }).from(vehicles).where(eq(vehicles.id, id)))[0].t;

    const asTrailer = await session.call("PATCH", `/api/vehicles/${truck}`, { actor: "admin", body: { vehicleType: "remorque" } });
    expect(apiErrorProblems(asTrailer.status, asTrailer.body, 409, undefined, asTrailer.headers.get("x-request-id"))).toEqual([]);
    const asTruck = await session.call("PATCH", `/api/vehicles/${trailerId}`, { actor: "admin", body: { vehicleType: "porteur" } });
    expect(apiErrorProblems(asTruck.status, asTruck.body, 409, undefined, asTruck.headers.get("x-request-id"))).toEqual([]);
    expect([await typeOf(truck), await typeOf(trailerId)]).toEqual(["porteur", "remorque"]);

    // Affectation terminée : le véhicule n'est plus attelé, le type se change.
    await db.update(assignments).set({ status: "cancelled" } as any).where(eq(assignments.missionId, missionId));
    const free = await session.call("PATCH", `/api/vehicles/${trailerId}`, { actor: "admin", body: { vehicleType: "porteur" } });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    // Type inchangé (autre champ) sur un véhicule attelé : jamais bloqué.
    const same = await session.call("PATCH", `/api/vehicles/${truck}`, { actor: "admin", body: { vehicleType: "porteur", color: "Bleu" } });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
  });

  it("PATCH sans trailerId conserve la remorque ; null la retire", async () => {
    const missionId = await mission();
    const [trailerId, truck, driverId] = [await trailer(), await vehicle(), await driver()];
    expect((await add("admin", missionId, { driverId, vehicleId: truck, trailerId })).status).toBe(201);

    const keep = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "admin", body: { assignment: { vehicleId: truck, driverId } } });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    expect((await rowsOf(missionId)).map((r) => r.trailerId)).toEqual([trailerId]);

    const remove = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "admin", body: { assignment: { vehicleId: truck, driverId, trailerId: null } } });
    expect(remove.status, JSON.stringify(remove.body)).toBe(200);
    expect((await rowsOf(missionId)).map((r) => r.trailerId)).toEqual([null]);
  });
});
