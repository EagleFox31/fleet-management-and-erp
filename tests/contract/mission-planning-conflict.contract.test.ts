import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, MIS2 : affectation et conflit de planning.
 * `GET /api/missions/:id/launch-readiness` expose le contrôle `planning_conflict`
 * (server/api/missions.routes.ts) : une mission active (planned, assigned, in_progress) qui
 * partage le véhicule ou le chauffeur sur une période qui se recoupe bloque le lancement.
 * `PUT /:id/status` -> in_progress refuse avec le même motif.
 */

const ACTORS = { admin: "admin", logistics: "logistics", technician: "technician", client: "client" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

const day = (d: number, h = 8) => new Date(Date.UTC(2031, 0, d, h, 0, 0));

async function driver() {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv") } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

async function mission(opts: {
  vehicleId: number;
  driverId: number;
  from: Date;
  to: Date;
  status?: "planned" | "assigned" | "in_progress" | "completed" | "cancelled" | "draft" | "delivered";
}) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MIS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      pickupDate: opts.from,
      deliveryDate: opts.to,
      status: opts.status ?? "assigned",
    } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: opts.vehicleId, driverId: opts.driverId } as any);
  return m;
}

async function conflict(missionId: number, actor: Actor = "logistics") {
  const res = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor });
  expect(res.status).toBe(200);
  const check = res.body.checks.find((c: any) => c.key === "planning_conflict");
  expect(check).toBeTruthy();
  return check.passed === false;
}

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

describe("MIS2 : conflit de planning", { timeout: 180000 }, () => {
  it("même véhicule, chauffeurs différents, périodes qui se recoupent : conflit", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const [d1, d2] = [await driver(), await driver()];
    await mission({ vehicleId: v.id, driverId: d1.id, from: day(10), to: day(12) });
    const b = await mission({ vehicleId: v.id, driverId: d2.id, from: day(11), to: day(13) });
    expect(await conflict(b.id)).toBe(true);
  });

  it("même chauffeur, véhicules différents, périodes qui se recoupent : conflit", async () => {
    const [v1, v2] = [await createTestVehicle(), await createTestVehicle()];
    ids.vehicleIds.push(v1.id, v2.id);
    const d = await driver();
    await mission({ vehicleId: v1.id, driverId: d.id, from: day(10), to: day(12) });
    const b = await mission({ vehicleId: v2.id, driverId: d.id, from: day(12, 6), to: day(14) });
    expect(await conflict(b.id)).toBe(true);
  });

  it("véhicule et chauffeur partagés mais périodes disjointes : pas de conflit", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12) });
    const b = await mission({ vehicleId: v.id, driverId: d.id, from: day(13), to: day(14) });
    expect(await conflict(b.id)).toBe(false);
  });

  it("véhicule et chauffeur distincts sur la même période : pas de conflit", async () => {
    const [v1, v2] = [await createTestVehicle(), await createTestVehicle()];
    ids.vehicleIds.push(v1.id, v2.id);
    const [d1, d2] = [await driver(), await driver()];
    await mission({ vehicleId: v1.id, driverId: d1.id, from: day(10), to: day(12) });
    const b = await mission({ vehicleId: v2.id, driverId: d2.id, from: day(10), to: day(12) });
    expect(await conflict(b.id)).toBe(false);
  });

  it.each(["completed", "cancelled", "draft", "delivered"] as const)(
    "l'autre mission est %s : elle ne bloque pas",
    async (status) => {
      const v = await createTestVehicle();
      ids.vehicleIds.push(v.id);
      const d = await driver();
      await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12), status });
      const b = await mission({ vehicleId: v.id, driverId: d.id, from: day(11), to: day(13) });
      expect(await conflict(b.id)).toBe(false);
    },
  );

  it.each(["planned", "assigned", "in_progress"] as const)("l'autre mission est %s : elle bloque", async (status) => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12), status });
    const b = await mission({ vehicleId: v.id, driverId: d.id, from: day(11), to: day(13) });
    expect(await conflict(b.id)).toBe(true);
  });

  it("une mission ne entre pas en conflit avec elle-même", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    const a = await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12) });
    expect(await conflict(a.id)).toBe(false);
  });

  it("la fin d'une mission et le début de la suivante à la même minute comptent comme conflit", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12, 8) });
    const b = await mission({ vehicleId: v.id, driverId: d.id, from: day(12, 8), to: day(13) });
    expect(await conflict(b.id)).toBe(true);
  });

  it("lancement refusé, statut inchangé", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const [d1, d2] = [await driver(), await driver()];
    await mission({ vehicleId: v.id, driverId: d1.id, from: day(10), to: day(12) });
    const b = await mission({ vehicleId: v.id, driverId: d2.id, from: day(11), to: day(13) });
    const res = await call("PUT", `/api/missions/${b.id}/status`, { actor: "admin", body: { status: "in_progress" } });
    expect(res.status).toBe(400);
    const [after] = await db.select().from(missions).where(eq(missions.id, b.id));
    expect(after.status).toBe("assigned");
  });

  // Le refus nomme ses motifs dans le message (le chef de parc voit pourquoi).
  // NB : la mission de test n'a pas de budget, le 400 seul ne prouve donc pas le conflit.
  describe("motif du refus", () => {
    let blockedId: number;
    beforeAll(async () => {
      const v = await createTestVehicle();
      ids.vehicleIds.push(v.id);
      const [d1, d2] = [await driver(), await driver()];
      await mission({ vehicleId: v.id, driverId: d1.id, from: day(10), to: day(12) });
      blockedId = (await mission({ vehicleId: v.id, driverId: d2.id, from: day(11), to: day(13) })).id;
      // Le conflit est bien là : sans cela le test ci-dessous ne prouverait rien.
      expect(await conflict(blockedId)).toBe(true);
    });

    it("le lancement (in_progress) est refusé avec le motif du conflit", async () => {
      const res = await call("PUT", `/api/missions/${blockedId}/status`, { actor: "admin", body: { status: "in_progress" } });
      expect(JSON.stringify(res.body)).toContain("Conflit planning");
    });
  });
});

describe("MIS2 : accès et entrées", { timeout: 180000 }, () => {
  it("mission inconnue : 404 ; id non numérique : 400", async () => {
    expect((await call("GET", "/api/missions/999999999/launch-readiness", { actor: "logistics" })).status).toBe(404);
    expect((await call("GET", "/api/missions/abc/launch-readiness", { actor: "logistics" })).status).toBe(400);
  });

  it("un compte client ne consulte pas le contrôle de lancement (403)", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    const a = await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12) });
    expect((await call("GET", `/api/missions/${a.id}/launch-readiness`, { actor: "client" })).status).toBe(403);
  });

  it("statut inconnu ou absent : 400", async () => {
    const v = await createTestVehicle();
    ids.vehicleIds.push(v.id);
    const d = await driver();
    const a = await mission({ vehicleId: v.id, driverId: d.id, from: day(10), to: day(12) });
    expect((await call("PUT", `/api/missions/${a.id}/status`, { actor: "admin", body: { status: "inconnu" } })).status).toBe(400);
    expect((await call("PUT", `/api/missions/${a.id}/status`, { actor: "admin", body: {} })).status).toBe(400);
  });
});
