import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, clients, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison chauffeur sur les GET de /api/operations (AGENTS §11, pendant du router.param de
 * missions.routes.ts) : un chauffeur ne liste que ses missions, ne lit pas les coûts ni les
 * agrégats de l'exploitation ; le personnel n'est pas filtré ; le client reste fermé par isStaff.
 */

const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  driverA: "driver",
  driverB: "driver",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const clientIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

let clientName = "";
let own: { id: number };
let foreign: { id: number };

/** Une fiche chauffeur par compte (uq_drivers_user_id). */
async function driverOf(userId: number) {
  const [d] = await db
    .insert(drivers)
    .values({ userId, firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

async function missionFor(driverId: number, status: string) {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("OPS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      clientId: clientIds[0],
      status,
      actualFuelCost: "1234",
    } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId, status: "accepted" } as any);
  return m;
}

function expectCleanError(res: { status: number; body: any }, status: number) {
  expect(res.status).toBe(status);
  expect(typeof res.body?.message).toBe("string");
  expect(typeof res.body?.code).toBe("string");
  expect(JSON.stringify(res.body)).not.toMatch(/select |insert |stack|at .*\.ts|ECONN|relation "/i);
}

const idsOf = (body: unknown) => (body as { id?: number; mission?: { id: number } }[]).map((m) => m.id ?? m.mission?.id);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  clientName = uniqueTestToken("CLI");
  const [c] = await db.insert(clients).values({ name: clientName } as any).returning();
  clientIds.push(c.id);
  const dA = await driverOf(session.userIdOf("driverA"));
  const dB = await driverOf(session.userIdOf("driverB"));
  own = await missionFor(dA.id, "assigned");
  foreign = await missionFor(dB.id, "in_progress");
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  if (clientIds.length > 0) await db.delete(clients).where(inArray(clients.id, clientIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("cloison chauffeur sur GET /api/operations", { timeout: 180000 }, () => {
  it("compte chauffeur : une seule fiche (uq_drivers_user_id)", async () => {
    const rows = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.userId, session.userIdOf("driverA")));
    expect(rows).toHaveLength(1);
  });

  it("GET /missions : A voit la sienne, pas celle de B", async () => {
    const res = await call("GET", "/api/operations/missions", { actor: "driverA" });
    expect(res.status).toBe(200);
    const listed = idsOf(res.body);
    expect(listed).toContain(own.id);
    expect(listed).not.toContain(foreign.id);
  });

  it("GET /missions/upcoming et /active : filtrées sur le chauffeur", async () => {
    const up = await call("GET", "/api/operations/missions/upcoming", { actor: "driverA" });
    expect(up.status).toBe(200);
    expect(idsOf(up.body)).toContain(own.id);
    const upB = await call("GET", "/api/operations/missions/upcoming", { actor: "driverB" });
    expect(idsOf(upB.body)).not.toContain(own.id);
    const act = await call("GET", "/api/operations/missions/active", { actor: "driverA" });
    expect(act.status).toBe(200);
    expect(idsOf(act.body)).not.toContain(foreign.id);
    const actB = await call("GET", "/api/operations/missions/active", { actor: "driverB" });
    expect(idsOf(actB.body)).toContain(foreign.id);
  });

  it("GET /missions/:id/costs : les coûts ne sont pas lus par le chauffeur (403), ni les siens ni ceux d'un autre", async () => {
    expectCleanError(await call("GET", `/api/operations/missions/${foreign.id}/costs`, { actor: "driverA" }), 403);
    expectCleanError(await call("GET", `/api/operations/missions/${own.id}/costs`, { actor: "driverA" }), 403);
  });

  it("agrégats d'exploitation (par client, stats) : fermés au chauffeur", async () => {
    expectCleanError(await call("GET", `/api/operations/missions/by-client/${clientName}`, { actor: "driverA" }), 403);
    expectCleanError(await call("GET", "/api/operations/stats/by-client", { actor: "driverA" }), 403);
    expectCleanError(await call("GET", "/api/operations/stats/by-destination", { actor: "driverA" }), 403);
  });

  it("le personnel lit tout", async () => {
    for (const actor of ["admin", "logistics"] as const) {
      const list = await call("GET", "/api/operations/missions", { actor });
      expect(list.status).toBe(200);
      expect(idsOf(list.body)).toEqual(expect.arrayContaining([own.id, foreign.id]));
      expect((await call("GET", `/api/operations/missions/${foreign.id}/costs`, { actor })).status).toBe(200);
      expect((await call("GET", "/api/operations/stats/by-client", { actor })).status).toBe(200);
      expect((await call("GET", `/api/operations/missions/by-client/${clientName}`, { actor })).status).toBe(200);
    }
    const act = await call("GET", "/api/operations/missions/active", { actor: "admin" });
    expect(idsOf(act.body)).toContain(foreign.id);
  });

  it("le client reste fermé par isStaff", async () => {
    for (const path of ["/missions", "/missions/upcoming", "/missions/active", `/missions/${own.id}/costs`, "/stats/by-client"]) {
      expectCleanError(await call("GET", `/api/operations${path}`, { actor: "client" }), 403);
    }
  });
});
