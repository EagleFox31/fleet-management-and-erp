import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lecture périmée : PATCH et PUT /status lisent le créneau et les affectations AVANT leur transaction.
 * Un PATCH concurrent qui change la paire entre-temps ne doit pas laisser le contrôle porter sur
 * l'ancienne paire. Déterministe : une connexion tient le verrou de ligne de la mission, la requête
 * s'y bloque (après sa lecture), la paire est remplacée, puis le verrou est libéré.
 */
const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const driverIds: number[] = [];
const missionIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const day = (d: number) => new Date(Date.UTC(2035, 0, d, 8, 0, 0));

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

async function seed(status: string, vehicleId: number, driverId: number, from: Date, to: Date) {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MSR"), pickupAddress: "A", deliveryAddress: "B", pickupDate: from, deliveryDate: to, status } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId, status: "pending" } as any);
  return m.id;
}

/** Attend qu'une requête soit bloquée PAR la connexion qui tient le verrou (pas par n'importe quel verrou de la base). */
async function waitForBlockedWriter(holderPid: number) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [holderPid]);
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("la requête ne s'est jamais bloquée sur le verrou de la mission");
}

/** Lance `request`, la laisse se bloquer sur la ligne mission, exécute `swap` en tenant le verrou, puis libère. */
async function racing<T>(missionId: number, request: () => Promise<T>, swap: (q: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<void>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM missions WHERE id = $1 FOR UPDATE", [missionId]);
    const holderPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
    const pending = request();
    await waitForBlockedWriter(holderPid);
    await swap((sql, params) => client.query(sql, params));
    await client.query("COMMIT");
    return await pending;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

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

describe("lecture périmée avant la transaction", { timeout: 120000 }, () => {
  it("PUT /status : la paire est remplacée pendant l'attente du verrou : 409 lisible, statut inchangé", async () => {
    const [v1, v2, d1, d2] = [await vehicle(), await vehicle(), await driver(), await driver()];
    await seed("assigned", v2, d2, day(10), day(12)); // occupe (v2, d2)
    const draft = await seed("draft", v1, d1, day(11), day(13)); // paire libre au moment de la lecture
    const res = await racing(
      draft,
      () => session.call("PUT", `/api/missions/${draft}/status`, { actor: "logistics", body: { status: "planned" } }),
      async (q) => void (await q("UPDATE assignments SET vehicle_id = $1, driver_id = $2 WHERE mission_id = $3", [v2, d2, draft])),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("vient d'être modifiée");
    expect(await statusOf(draft)).toBe("draft");
  });

  it("PATCH : la paire est remplacée pendant l'attente du verrou : 409 lisible, dates inchangées", async () => {
    const [v1, v2, d1, d2] = [await vehicle(), await vehicle(), await driver(), await driver()];
    await seed("assigned", v2, d2, day(24), day(27)); // occupe (v2, d2) sur le nouveau créneau
    const mine = await seed("planned", v1, d1, day(20), day(21));
    const res = await racing(
      mine,
      () => session.call("PATCH", `/api/missions/${mine}`, { actor: "logistics", body: { pickupDate: day(25).toISOString(), deliveryDate: day(26).toISOString() } }),
      async (q) => void (await q("UPDATE assignments SET vehicle_id = $1, driver_id = $2 WHERE mission_id = $3", [v2, d2, mine])),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("vient d'être modifiée");
    const [row] = await db.select().from(missions).where(eq(missions.id, mine));
    expect(new Date(row.pickupDate as any).toISOString()).toBe(day(20).toISOString());
  });

  it("PATCH de dates sur une mission sans affectation : une affectation ajoutée entre-temps est revue : 409, dates inchangées", async () => {
    const [v, d] = [await vehicle(), await driver()];
    await seed("assigned", v, d, day(34), day(37)); // occupe (v, d) sur le nouveau créneau
    const [m] = await db
      .insert(missions)
      .values({ orderNumber: uniqueTestToken("MSR"), pickupAddress: "A", deliveryAddress: "B", pickupDate: day(30), deliveryDate: day(31), status: "planned" } as any)
      .returning();
    missionIds.push(m.id);
    const res = await racing(
      m.id,
      () => session.call("PATCH", `/api/missions/${m.id}`, { actor: "logistics", body: { pickupDate: day(35).toISOString(), deliveryDate: day(36).toISOString() } }),
      // Un ajout d'affectation concurrent, contrôlé sur les anciennes dates (libres), valide avant le PATCH.
      async (q) => void (await q("INSERT INTO assignments (mission_id, vehicle_id, driver_id, status) VALUES ($1, $2, $3, 'pending')", [m.id, v, d])),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("vient d'être modifiée");
    const [row] = await db.select().from(missions).where(eq(missions.id, m.id));
    expect(new Date(row.pickupDate as any).toISOString()).toBe(day(30).toISOString());
  });
});
