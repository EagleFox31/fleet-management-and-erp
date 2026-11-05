import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * PUT /api/missions/:id/status vers planned ou assigned : la mission devient active, ses affectations
 * ne doivent pas chevaucher une autre mission active (findPlanningClash, sous verrou). Les autres
 * transitions (cancelled…) ne déclenchent aucun contrôle.
 */
const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const driverIds: number[] = [];
const missionIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const day = (d: number) => new Date(Date.UTC(2034, 0, d, 8, 0, 0));

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

/** Mission posée directement en base, avec son affectation. */
async function seed(status: string, vehicleId: number, driverId: number, from: Date, to: Date) {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MST"), pickupAddress: "A", deliveryAddress: "B", pickupDate: from, deliveryDate: to, status } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId, status: "pending" } as any);
  return m.id;
}

const put = (id: number, status: string) => session.call("PUT", `/api/missions/${id}/status`, { actor: "logistics", body: { status } });
const statusOf = async (id: number) => (await db.select({ s: missions.status }).from(missions).where(eq(missions.id, id)))[0].s;

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("PUT /:id/status : conflit de planning", { timeout: 120000 }, () => {
  it("draft vers planned avec un chauffeur pris : 409, statut inchangé", async () => {
    const [v1, v2, d] = [await vehicle(), await vehicle(), await driver()];
    await seed("assigned", v1, d, day(10), day(12));
    const draft = await seed("draft", v2, d, day(11), day(13));
    const res = await put(draft, "planned");
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("Conflit de planning");
    expect(await statusOf(draft)).toBe("draft");
  });

  it("planned vers assigned avec un véhicule pris : 409, statut inchangé", async () => {
    const [v, d1, d2] = [await vehicle(), await driver(), await driver()];
    await seed("in_progress", v, d1, day(10), day(12));
    const planned = await seed("planned", v, d2, day(12), day(14));
    const res = await put(planned, "assigned");
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("Ce véhicule est déjà affecté");
    expect(await statusOf(planned)).toBe("planned");
  });

  it("créneau libre : draft vers planned puis planned vers assigned passent (non-régression)", async () => {
    const [v, d] = [await vehicle(), await driver()];
    await seed("assigned", v, d, day(10), day(12));
    const draft = await seed("draft", v, d, day(13), day(14));
    expect((await put(draft, "planned")).status).toBe(200);
    expect((await put(draft, "assigned")).status).toBe(200);
    expect(await statusOf(draft)).toBe("assigned");
  });

  it("annulation d'une mission en conflit : aucun contrôle de planning (non-régression)", async () => {
    const [v, d] = [await vehicle(), await driver()];
    await seed("assigned", v, d, day(10), day(12));
    const clashing = await seed("planned", v, d, day(11), day(13));
    const res = await put(clashing, "cancelled");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(clashing)).toBe("cancelled");
  });

  it("deux brouillons du même chauffeur passés en planned en même temps : un seul passe", async () => {
    const [v1, v2, d] = [await vehicle(), await vehicle(), await driver()];
    const a = await seed("draft", v1, d, day(20), day(21));
    const b = await seed("draft", v2, d, day(20), day(21));
    const results = await Promise.all([put(a, "planned"), put(b, "planned")]);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([200, 409]);
  });
});
