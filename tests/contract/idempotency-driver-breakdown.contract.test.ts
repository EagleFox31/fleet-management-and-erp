import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_REPLAYED_HEADER } from "../../server/lib/idempotency-config";
import { assignments, drivers, idempotencyKeys, incidents, missions, vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * V5b-1, appli chauffeur hors ligne : la déclaration de panne et le statut de mission se rejouent
 * sans doublon.
 * - rejeu : même clé, même requête = même incident, même OT, la route ne s'exécute pas ;
 * - concurrence : deux requêtes simultanées avec la même clé = un seul incident et un seul OT,
 *   la seconde reçoit 409 `IDEMPOTENCY_IN_PROGRESS` (ou le rejeu si la première a fini) ;
 * - issue incertaine : la clé de la panne est gardée, jamais reprise.
 * La preuve « non réexécutée » modifie la base entre les deux appels, comme #10b.
 */

const ACTORS = { driverA: "driver", driverB: "driver", admin: "admin", viewer: "viewer" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const previousFlags = process.env.FEATURE_FLAGS;
const FUTURE = "2099-01-01";
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let driverFicheId = 0;
let driverBFicheId = 0;

type Sent = { status: number; body: any; replayed: string | null };

async function send(method: "POST" | "PUT", path: string, body: unknown, key?: string, actor: Actor = "driverA"): Promise<Sent> {
  const res = await fetch(session.baseUrl + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies.get(actor)!,
      ...(key !== undefined ? { [IDEMPOTENCY_HEADER]: key } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), replayed: res.headers.get(IDEMPOTENCY_REPLAYED_HEADER) };
}

async function assignedMission(status: string, driverId = driverFicheId) {
  const vehicle = await createTestVehicle({});
  ids.vehicleIds.push(vehicle.id);
  await db
    .update(vehicles)
    .set({ insuranceExpiry: FUTURE, technicalInspectionDate: FUTURE, licensePlateExpiry: FUTURE } as any)
    .where(eq(vehicles.id, vehicle.id));
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any)
    .returning();
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId, status: "accepted" } as any);
  return { mission, vehicle };
}

async function counts(vehicleId: number) {
  const inc = await db.select({ id: incidents.id }).from(incidents).where(eq(incidents.vehicleId, vehicleId));
  const ots = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.vehicleId, vehicleId));
  return { incidents: inc.length, workOrders: ots.length };
}

const declaration = (vehicleId: number, description = "Fuite d'huile sous le moteur") => ({ vehicleId, description, severity: "high" });

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "offline-writes=on";
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [driver] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driverA"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverFicheId = driver.id;
  driverIds.push(driver.id);
  const [driverB] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driverB"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverBFicheId = driverB.id;
  driverIds.push(driverB.id);
}, 120000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  try {
    if (ids.vehicleIds.length > 0) {
      const found = await db.select({ id: incidents.id, workOrderId: incidents.workOrderId }).from(incidents).where(inArray(incidents.vehicleId, ids.vehicleIds));
      if (found.length > 0) await db.delete(incidents).where(inArray(incidents.id, found.map((i) => i.id)));
      await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
    }
  } catch {
    // Le nettoyage commun ci-dessous tentera le reste.
  }
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  // Les clés d'idempotence partent en cascade avec les comptes.
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("V5b-1 : déclaration de panne rejouable", { timeout: 120000 }, () => {
  it("même clé deux fois : même incident, même OT, la route ne s'exécute pas", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");

    const first = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.replayed).toBeNull();
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });

    // Une réexécution créerait un second incident et un second OT.
    const replay = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(replay.status).toBe(201);
    expect(replay.replayed).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
  });

  it("même clé, autre corps : 422, rien n'est écrit", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");
    expect((await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key)).status).toBe(201);

    const other = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id, "Autre description"), key);
    expect(other.status).toBe(422);
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
  });

  it("deux requêtes simultanées, même clé : un seul incident et un seul OT", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");

    const [a, b] = await Promise.all([
      send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key),
      send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key),
    ]);

    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
    const executed = [a, b].filter((r) => r.status === 201 && r.replayed === null);
    expect(executed).toHaveLength(1);
    const other = a === executed[0] ? b : a;
    if (other.status === 409) {
      expect(other.body.code).toBe("IDEMPOTENCY_IN_PROGRESS");
      expect(other.body.message).toMatch(/[a-z]/i);
    } else {
      // La première avait déjà fini : rejeu de sa réponse.
      expect(other.status).toBe(201);
      expect(other.replayed).toBe("true");
      expect(other.body).toEqual(executed[0].body);
    }
  });

  it("sans en-tête : comportement inchangé, chaque envoi crée sa déclaration", async () => {
    const { vehicle } = await assignedMission("in_progress");
    expect((await send("POST", "/api/driver/breakdowns", declaration(vehicle.id))).status).toBe(201);
    expect((await send("POST", "/api/driver/breakdowns", declaration(vehicle.id))).status).toBe(201);
    expect((await counts(vehicle.id)).incidents).toBe(2);
  });

  it("véhicule hors affectation : 403, la clé est libérée", async () => {
    const stranger = await createTestVehicle({});
    ids.vehicleIds.push(stranger.id);
    const key = uniqueTestToken("pan");
    const res = await send("POST", "/api/driver/breakdowns", declaration(stranger.id), key);
    expect(res.status).toBe(403);
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, session.userIdOf("driverA")), eq(idempotencyKeys.key, key)));
    expect(rows).toHaveLength(0);
    expect(await counts(stranger.id)).toEqual({ incidents: 0, workOrders: 0 });
  });
});

async function keyRows(actor: Actor, key: string) {
  return db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, session.userIdOf(actor)), eq(idempotencyKeys.key, key)));
}

describe("V5b-1b : la clé d'une panne n'est gardée que si l'écriture a pu avoir lieu", { timeout: 120000 }, () => {
  it("échec de la transaction avant validation : 503 lisible, clé libérée, le réessai crée l'incident", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");
    // Interblocage ou coupure avant toute écriture validée.
    vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("deadlock detected"));

    const failed = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(failed.status, JSON.stringify(failed.body)).toBe(503);
    // La garde de sortie normalise toute 5xx en INTERNAL + référence ; le code dédié ne sert qu'à libérer la clé.
    expect(failed.body.code).toBe("INTERNAL");
    expect(JSON.stringify(failed.body)).not.toMatch(/deadlock/i);
    expect(await keyRows("driverA", key)).toHaveLength(0);
    expect(await counts(vehicle.id)).toEqual({ incidents: 0, workOrders: 0 });

    const retry = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.replayed).toBeNull();
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
  });

  it("COMMIT validé mais accusé perdu : 5xx, clé conservée, le rejeu reçoit 409 sans seconde panne", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");
    // Une transaction rejetée n'est pas une transaction annulée : le corps et le COMMIT ont eu lieu.
    const real = db.transaction.bind(db) as (...args: any[]) => Promise<unknown>;
    vi.spyOn(db, "transaction").mockImplementationOnce((async (...args: any[]) => {
      await real(...args);
      throw new Error("Connection terminated");
    }) as any);

    const lost = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(lost.status, JSON.stringify(lost.body)).toBeGreaterThanOrEqual(500);
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
    const rows = await keyRows("driverA", key);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("in_progress");

    const retry = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(retry.status, JSON.stringify(retry.body)).toBe(409);
    expect(retry.body.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(await counts(vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
  });

  it("véhicule inexistant (retard, sans OT) : 404 lisible et non 500, clé libérée", async () => {
    const [{ maxId }] = await db.select({ maxId: sql<number>`coalesce(max(${vehicles.id}), 0)::int` }).from(vehicles);
    const key = uniqueTestToken("pan");
    const res = await send("POST", "/api/driver/breakdowns", { ...declaration(maxId + 100000), type: "delay" }, key, "admin");
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.code).toBe("INCIDENT_VEHICLE_NOT_FOUND");
    expect(await keyRows("admin", key)).toHaveLength(0);
  });

  it("véhicule inexistant (panne, avec OT) : 404, clé libérée", async () => {
    const [{ maxId }] = await db.select({ maxId: sql<number>`coalesce(max(${vehicles.id}), 0)::int` }).from(vehicles);
    const key = uniqueTestToken("pan");
    const res = await send("POST", "/api/driver/breakdowns", declaration(maxId + 100000), key, "admin");
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(await keyRows("admin", key)).toHaveLength(0);
  });

  it("même clé, deux comptes : chacun écrit sa propre panne, sans rejeu croisé", async () => {
    const a = await assignedMission("in_progress");
    const b = await assignedMission("in_progress", driverBFicheId);
    const key = uniqueTestToken("pan");

    const first = await send("POST", "/api/driver/breakdowns", declaration(a.vehicle.id), key, "driverA");
    const second = await send("POST", "/api/driver/breakdowns", declaration(b.vehicle.id), key, "driverB");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.replayed).toBeNull();
    expect(second.body.id).not.toBe(first.body.id);
    expect(await counts(a.vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
    expect(await counts(b.vehicle.id)).toEqual({ incidents: 1, workOrders: 1 });
    expect(await keyRows("driverA", key)).toHaveLength(1);
    expect(await keyRows("driverB", key)).toHaveLength(1);
  });

  it("lecteur refusé (403) : clé libérée, rien d'écrit", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");
    const res = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key, "viewer");
    expect(res.status).toBe(403);
    expect(await keyRows("viewer", key)).toHaveLength(0);
    expect(await counts(vehicle.id)).toEqual({ incidents: 0, workOrders: 0 });
  });

  it("le 409 « en cours » ne promet pas que la panne apparaîtra", async () => {
    const { vehicle } = await assignedMission("in_progress");
    const key = uniqueTestToken("pan");
    // Réservation laissée en cours par une requête dont l'issue est inconnue.
    const hold = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(hold.status).toBe(201);
    await db
      .update(idempotencyKeys)
      .set({ state: "in_progress", responseStatus: null, responseBody: null } as any)
      .where(and(eq(idempotencyKeys.userId, session.userIdOf("driverA")), eq(idempotencyKeys.key, key)));
    const again = await send("POST", "/api/driver/breakdowns", declaration(vehicle.id), key);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    expect(/appara[iî]tra/i.test(String(again.body.message))).toBe(false);
  });
});

describe("V5b-1 : statut de mission rejouable", { timeout: 120000 }, () => {
  it("même clé deux fois : la mission n'est pas retransitionnée", async () => {
    const { mission } = await assignedMission("in_progress");
    const key = uniqueTestToken("mis");

    const first = await send("PUT", `/api/missions/${mission.id}/status`, { status: "delivered" }, key);
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    // Une réexécution remettrait la mission à « livrée ».
    await db.update(missions).set({ status: "in_progress" } as any).where(eq(missions.id, mission.id));

    const replay = await send("PUT", `/api/missions/${mission.id}/status`, { status: "delivered" }, key);
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe("true");
    expect(replay.body).toEqual(first.body);
    const [row] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, mission.id));
    expect(row.status).toBe("in_progress");
  });

  it("deux requêtes simultanées, même clé : une seule transition, l'autre en cours ou rejouée", async () => {
    const { mission } = await assignedMission("in_progress");
    const key = uniqueTestToken("mis");

    const [a, b] = await Promise.all([
      send("PUT", `/api/missions/${mission.id}/status`, { status: "delivered" }, key),
      send("PUT", `/api/missions/${mission.id}/status`, { status: "delivered" }, key),
    ]);

    const executed = [a, b].filter((r) => r.status === 200 && r.replayed === null);
    expect(executed, JSON.stringify([a.body, b.body])).toHaveLength(1);
    const other = a === executed[0] ? b : a;
    if (other.status === 409) expect(other.body.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    else expect(other.replayed).toBe("true");
  });
});
