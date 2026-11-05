import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * POST /api/missions avec affectation : la mission naît dans l'état que lui donneraient
 * les chemins d'ajout après coup (PATCH { assignment }, POST /:id/assignments).
 *  - planned + affectation => assigned, affectation pending ;
 *  - draft + affectation   => draft (un brouillon reste brouillon) ;
 *  - affectation refusée   => aucune mission créée.
 * Le passage à « accepted » reste celui de PUT /:id/status, inchangé (question ouverte :
 * « assigned » veut dire affectée, pas acceptée).
 */
const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const driverIds: number[] = [];
const orderNumbers: string[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

async function driver(extra: Record<string, unknown> = {}) {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE, ...extra } as any)
    .returning();
  driverIds.push(d.id);
  return d.id;
}

async function vehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v.id;
}

function create(body: Record<string, unknown>) {
  const orderNumber = uniqueTestToken("MCA");
  orderNumbers.push(orderNumber);
  return session.call("POST", "/api/missions", {
    actor: "logistics",
    body: { orderNumber, pickupAddress: "Douala", deliveryAddress: "Yaoundé", ...body },
  });
}

const rowsOf = (missionId: number) => db.select().from(assignments).where(eq(assignments.missionId, missionId));

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

describe("création de mission avec affectation", { timeout: 120000 }, () => {
  it("planned + véhicule et chauffeur : assigned, affectation pending", async () => {
    const vehicleId = await vehicle();
    const driverId = await driver();
    const res = await create({ status: "planned", assignment: { vehicleId, driverId } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("assigned");
    const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(row.status).toBe("assigned");
    expect((await rowsOf(res.body.id)).map((r) => ({ vehicleId: r.vehicleId, driverId: r.driverId, status: r.status }))).toEqual([
      { vehicleId, driverId, status: "pending" },
    ]);
  });

  it("planned sans affectation : reste planned (non-régression)", async () => {
    const res = await create({ status: "planned" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("planned");
    expect(await rowsOf(res.body.id)).toHaveLength(0);
  });

  it("draft + affectation : reste draft, affectation créée", async () => {
    const res = await create({ status: "draft", assignment: { vehicleId: await vehicle(), driverId: await driver() } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(await rowsOf(res.body.id)).toHaveLength(1);
  });

  it("affectation refusée (chauffeur désactivé) : 400 et aucune mission créée", async () => {
    const res = await create({
      status: "planned",
      assignment: { vehicleId: await vehicle(), driverId: await driver({ isActive: false }) },
    });
    expect(res.status).toBe(400);
    const found = await db.select({ id: missions.id }).from(missions).where(inArray(missions.orderNumber, orderNumbers));
    expect(found.map((m) => m.id)).not.toContain(res.body?.id);
    const refused = orderNumbers[orderNumbers.length - 1];
    expect(await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, refused))).toHaveLength(0);
  });

  it("l'insertion de l'affectation échoue dans la transaction : 500 et aucune mission (pas d'orpheline)", async () => {
    const vehicleId = await vehicle();
    const driverId = await driver();
    const trigger = `c7_fail_${vehicleId}`;
    // Échec réel côté base, après l'INSERT de la mission : un déclencheur refuse cette affectation-là.
    await pool.query(`CREATE OR REPLACE FUNCTION ${trigger}() RETURNS trigger AS $$ BEGIN
      IF NEW.vehicle_id = ${vehicleId} THEN RAISE EXCEPTION 'affectation refusée par le test'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON assignments FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    try {
      const res = await create({ status: "planned", assignment: { vehicleId, driverId } });
      expect(res.status).toBe(500);
      const refused = orderNumbers[orderNumbers.length - 1];
      expect(await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, refused))).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON assignments`);
      await pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
  });
});
