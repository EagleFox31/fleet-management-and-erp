import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../../server/lib/idempotency-config";
import { assignments, drivers, idempotencyKeys, missions, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, idempotence des écritures chauffeur (CDC #10b), drapeau `offline-writes`.
 * - même clé, même requête : la réponse enregistrée est rejouée, la route ne s'exécute pas ;
 * - même clé, autre corps : 422 ; clé invalide : 400 ;
 * - sans en-tête ou drapeau coupé : comportement inchangé ;
 * - refus de droits (403) : la clé n'est pas gardée, le client pourra réessayer.
 * La preuve « non réexécutée » modifie la base entre les deux appels : un second passage
 * dans la route verrait l'état changé et répondrait autrement.
 */

const ACTORS = { driverA: "driver", driverB: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const previousFlags = process.env.FEATURE_FLAGS;
const FUTURE = "2099-01-01";
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

type Sent = { status: number; body: any; replayed: string | null };

async function put(path: string, body: unknown, actor: Actor, key?: string): Promise<Sent> {
  const res = await fetch(session.baseUrl + path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies.get(actor)!,
      ...(key !== undefined ? { [IDEMPOTENCY_HEADER]: key } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), replayed: res.headers.get(IDEMPOTENCY_REPLAYED_HEADER) };
}

async function newVehicle() {
  const v = await createTestVehicle({});
  ids.vehicleIds.push(v.id);
  await db
    .update(vehicles)
    .set({ insuranceExpiry: FUTURE, technicalInspectionDate: FUTURE, licensePlateExpiry: FUTURE, mileage: 100, lastMileage: 100, currentKilometers: 100 } as any)
    .where(eq(vehicles.id, v.id));
  return v;
}

async function newMission(actor: Actor, status: string) {
  return (await assign(actor, status)).mission;
}

/** Véhicule affecté au chauffeur (affectation active) : seul cas où il saisit le kilométrage. */
async function assignedVehicle(actor: Actor = "driverA") {
  return (await assign(actor, "in_progress")).vehicle;
}

const ficheOf = new Map<Actor, number>();
/** Une seule fiche par compte (#113, `uq_drivers_user_id`). */
async function driverFiche(actor: Actor) {
  const known = ficheOf.get(actor);
  if (known !== undefined) return known;
  const [driver] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf(actor), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(driver.id);
  ficheOf.set(actor, driver.id);
  return driver.id;
}

async function assign(actor: Actor, status: string) {
  const vehicle = await newVehicle();
  const driver = { id: await driverFiche(actor) };
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any)
    .returning();
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "accepted" } as any);
  return { mission, vehicle };
}

async function statusOf(missionId: number) {
  const [row] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, missionId));
  return row.status;
}

async function keyRow(actor: Actor, key: string) {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, session.userIdOf(actor)), eq(idempotencyKeys.key, key)));
  return row;
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "offline-writes=on";
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  // Les clés d'idempotence partent en cascade avec les comptes.
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("CDC #10b : kilométrage rejouable", { timeout: 120000 }, () => {
  it("même clé deux fois : la seconde est rejouée sans réécrire", async () => {
    const vehicle = await assignedVehicle();
    const key = uniqueTestToken("km");

    const first = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", key);
    expect(first.status).toBe(200);
    expect(first.replayed).toBeNull();

    // Une réexécution refuserait 1000 km, inférieur au compteur désormais à 5000.
    await db.update(vehicles).set({ mileage: 5000, lastMileage: 5000, currentKilometers: 5000 } as any).where(eq(vehicles.id, vehicle.id));

    const replay = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", key);
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe("true");
    expect(replay.body).toEqual(first.body);
    const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.mileage).toBe(5000);
  });

  it("même clé, autre corps : 422 lisible, rien n'est écrit", async () => {
    const vehicle = await assignedVehicle();
    const key = uniqueTestToken("km");
    expect((await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", key)).status).toBe(200);

    const other = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 2000 }, "driverA", key);
    expect(other.status).toBe(422);
    expect(other.body.message).toMatch(/autre opération/);
    const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.mileage).toBe(1000);
  });

  it("un refus métier (400) est enregistré et rejoué tel quel", async () => {
    const vehicle = await assignedVehicle();
    const key = uniqueTestToken("km");
    const first = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 50 }, "driverA", key);
    expect(first.status).toBe(400);

    const replay = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 50 }, "driverA", key);
    expect(replay.status).toBe(400);
    expect(replay.replayed).toBe("true");
    expect(replay.body.message).toBe(first.body.message);
  });

  it("clé invalide : 400, la route ne s'exécute pas", async () => {
    const vehicle = await assignedVehicle();
    const res = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", "x".repeat(256));
    expect(res.status).toBe(400);
    const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicle.id));
    expect(row.mileage).toBe(100);
  });

  it("sans en-tête : comportement inchangé, aucune clé gardée", async () => {
    const vehicle = await assignedVehicle();
    const keysOfA = async () => (await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.userId, session.userIdOf("driverA")))).length;
    const before = await keysOfA();
    const res = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA");
    expect(res.status).toBe(200);
    expect(res.replayed).toBeNull();
    expect(await keysOfA()).toBe(before);
  });

  it("drapeau coupé : l'en-tête est ignoré, la route s'exécute à chaque fois", async () => {
    const vehicle = await assignedVehicle();
    const key = uniqueTestToken("km");
    process.env.FEATURE_FLAGS = "offline-writes=off";
    try {
      expect((await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", key)).status).toBe(200);
      await db.update(vehicles).set({ mileage: 5000, lastMileage: 5000, currentKilometers: 5000 } as any).where(eq(vehicles.id, vehicle.id));
      const second = await put(`/api/vehicles/${vehicle.id}/mileage`, { kilometers: 1000 }, "driverA", key);
      expect(second.status).toBe(400);
      expect(second.replayed).toBeNull();
      expect(await keyRow("driverA", key)).toBeUndefined();
    } finally {
      process.env.FEATURE_FLAGS = "offline-writes=on";
    }
  });
});

describe("CDC #10b : statut de mission rejouable", { timeout: 120000 }, () => {
  it("même clé deux fois : la mission n'est pas retransitionnée", async () => {
    const mission = await newMission("driverA", "in_progress");
    const key = uniqueTestToken("mis");

    const first = await put(`/api/missions/${mission.id}/status`, { status: "delivered" }, "driverA", key);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await statusOf(mission.id)).toBe("delivered");

    // Une réexécution remettrait la mission à « livrée ».
    await db.update(missions).set({ status: "in_progress" } as any).where(eq(missions.id, mission.id));

    const replay = await put(`/api/missions/${mission.id}/status`, { status: "delivered" }, "driverA", key);
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(await statusOf(mission.id)).toBe("in_progress");
  });

  it("mission d'un autre chauffeur : 403, la clé est libérée", async () => {
    const foreign = await newMission("driverB", "assigned");
    const key = uniqueTestToken("mis");

    const res = await put(`/api/missions/${foreign.id}/status`, { status: "in_progress" }, "driverA", key);
    expect(res.status).toBe(403);
    expect(res.replayed).toBeNull();
    expect(await keyRow("driverA", key)).toBeUndefined();
    expect(await statusOf(foreign.id)).toBe("assigned");
  });
});
