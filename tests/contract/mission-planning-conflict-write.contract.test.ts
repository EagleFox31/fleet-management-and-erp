import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Conflit de planning à l'ÉCRITURE : un chauffeur ou un véhicule déjà pris sur le créneau ne peut être
 * affecté ni à la création (POST /api/missions), ni par PATCH /:id (changement de véhicule, de chauffeur
 * ou de dates). Même règle et même message que POST /:id/assignments (findPlanningClash).
 */
const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const driverIds: number[] = [];
const orderNumbers: string[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const day = (d: number, h = 8) => new Date(Date.UTC(2032, 0, d, h, 0, 0));

async function driver() {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(d.id);
  return d.id;
}

async function vehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v.id;
}

/** Mission déjà en base, affectée : elle occupe son créneau. */
async function occupy(vehicleId: number, driverId: number, from: Date, to: Date) {
  const orderNumber = uniqueTestToken("MPW");
  orderNumbers.push(orderNumber);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber, pickupAddress: "A", deliveryAddress: "B", pickupDate: from, deliveryDate: to, status: "assigned" } as any)
    .returning();
  await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId, status: "pending" } as any);
  return m;
}

function create(body: Record<string, unknown>) {
  const orderNumber = uniqueTestToken("MPW");
  orderNumbers.push(orderNumber);
  return session.call("POST", "/api/missions", {
    actor: "logistics",
    body: { orderNumber, pickupAddress: "Douala", deliveryAddress: "Yaoundé", status: "planned", ...body },
  });
}

const patch = (id: number, body: Record<string, unknown>) => session.call("PATCH", `/api/missions/${id}`, { actor: "logistics", body });
const rowsOf = (missionId: number) => db.select().from(assignments).where(eq(assignments.missionId, missionId));
const byOrder = (orderNumber: string) => db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, orderNumber));

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (orderNumbers.length > 0) {
    const created = await db.select({ id: missions.id }).from(missions).where(inArray(missions.orderNumber, orderNumbers));
    const missionIds = created.map((m) => m.id);
    if (missionIds.length > 0) {
      await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
      await db.delete(missions).where(inArray(missions.id, missionIds));
    }
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("création de mission avec affectation : conflit de planning", { timeout: 120000 }, () => {
  it("chauffeur déjà pris sur le créneau : 409, aucune mission créée", async () => {
    const [v1, v2, d] = [await vehicle(), await vehicle(), await driver()];
    await occupy(v1, d, day(10), day(12));
    const res = await create({ pickupDate: day(11).toISOString(), deliveryDate: day(13).toISOString(), assignment: { vehicleId: v2, driverId: d } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("Ce chauffeur est déjà affecté");
    expect(await byOrder(orderNumbers[orderNumbers.length - 1])).toHaveLength(0);
  });

  it("véhicule déjà pris sur le créneau : 409, aucune mission créée", async () => {
    const [v, d1, d2] = [await vehicle(), await driver(), await driver()];
    await occupy(v, d1, day(10), day(12));
    const res = await create({ pickupDate: day(12).toISOString(), deliveryDate: day(14).toISOString(), assignment: { vehicleId: v, driverId: d2 } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("Ce véhicule est déjà affecté");
    expect(await byOrder(orderNumbers[orderNumbers.length - 1])).toHaveLength(0);
  });

  it("créneau libre : 201 et mission assigned (non-régression)", async () => {
    const [v, d] = [await vehicle(), await driver()];
    await occupy(v, d, day(10), day(12));
    const res = await create({ pickupDate: day(13).toISOString(), deliveryDate: day(14).toISOString(), assignment: { vehicleId: v, driverId: d } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("assigned");
  });

  it("deux créations simultanées sur le même chauffeur : une seule passe", async () => {
    const [v1, v2, d] = [await vehicle(), await vehicle(), await driver()];
    const dates = { pickupDate: day(20).toISOString(), deliveryDate: day(21).toISOString() };
    const results = await Promise.all([
      create({ ...dates, assignment: { vehicleId: v1, driverId: d } }),
      create({ ...dates, assignment: { vehicleId: v2, driverId: d } }),
    ]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    const active = await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.driverId, d));
    expect(active).toHaveLength(1);
  });
});

describe("PATCH /api/missions/:id : conflit de planning", { timeout: 120000 }, () => {
  async function setup() {
    const [v, d] = [await vehicle(), await driver()];
    await occupy(v, d, day(10), day(12));
    const mine = await create({ pickupDate: day(20).toISOString(), deliveryDate: day(22).toISOString(), assignment: { vehicleId: await vehicle(), driverId: await driver() } });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    return { v, d, mineId: mine.body.id as number, mineBefore: (await rowsOf(mine.body.id))[0] };
  }

  it("changer de chauffeur vers un chauffeur pris : 409, affectation inchangée", async () => {
    const { d, mineId, mineBefore } = await setup();
    // Le créneau de la mission passe sur celui du chauffeur occupé, sans affectation à contrôler.
    const moved = await create({ pickupDate: day(10).toISOString(), deliveryDate: day(11).toISOString(), assignment: { vehicleId: await vehicle(), driverId: await driver() } });
    expect(moved.status).toBe(201);
    const res = await patch(moved.body.id, { assignment: { vehicleId: (await rowsOf(moved.body.id))[0].vehicleId, driverId: d } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await rowsOf(moved.body.id))[0].driverId).not.toBe(d);
    expect(mineBefore.missionId).toBe(mineId);
  });

  it("changer de véhicule vers un véhicule pris : 409, affectation inchangée", async () => {
    const { v } = await setup();
    const moved = await create({ pickupDate: day(10).toISOString(), deliveryDate: day(11).toISOString(), assignment: { vehicleId: await vehicle(), driverId: await driver() } });
    expect(moved.status).toBe(201);
    const before = (await rowsOf(moved.body.id))[0];
    const res = await patch(moved.body.id, { assignment: { vehicleId: v, driverId: before.driverId } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((await rowsOf(moved.body.id))[0].vehicleId).toBe(before.vehicleId);
  });

  it("affectation renvoyée à l'identique : aucun contrôle, 200", async () => {
    const { mineId } = await setup();
    const row = (await rowsOf(mineId))[0];
    const res = await patch(mineId, { assignment: { vehicleId: row.vehicleId, driverId: row.driverId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("changer seulement les dates vers un créneau déjà pris par le chauffeur : 409, dates inchangées", async () => {
    const [v, d] = [await vehicle(), await driver()];
    await occupy(v, d, day(10), day(12));
    const mine = await create({ pickupDate: day(20).toISOString(), deliveryDate: day(21).toISOString(), assignment: { vehicleId: v, driverId: d } });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    const res = await patch(mine.body.id, { pickupDate: day(11).toISOString(), deliveryDate: day(13).toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    const [row] = await db.select().from(missions).where(eq(missions.id, mine.body.id));
    expect(new Date(row.pickupDate as any).toISOString()).toBe(day(20).toISOString());
  });

  it("changer les dates vers un créneau libre : 200", async () => {
    const [v, d] = [await vehicle(), await driver()];
    const mine = await create({ pickupDate: day(20).toISOString(), deliveryDate: day(21).toISOString(), assignment: { vehicleId: v, driverId: d } });
    expect(mine.status).toBe(201);
    const res = await patch(mine.body.id, { pickupDate: day(25).toISOString(), deliveryDate: day(26).toISOString() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
