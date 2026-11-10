import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { resetVehiclePositionBroadcasts } from "../../server/lib/vehicle-position-realtime";
import { assignments, drivers, missions, vehiclePositions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * GPS V1 téléphone, API : ingestion du chauffeur, lecture (dernière position, trace), points A/B.
 * Drapeau `gps` allumé pour la suite ; tout est créé sous `TEST*` puis supprimé.
 */
const ACTORS = {
  driverA: "driver", driverB: "driver", admin: "admin", logistics: "logistics", management: "management",
  workshop: "workshop_manager", client: "client", warehouse: "warehouse",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const previousFlags = process.env.FEATURE_FLAGS;
const FUTURE = "2099-01-01";
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let driverAId = 0;
let missionId = 0;
let vehicleId = 0;
let waitingMissionId = 0;
const broadcasts: Array<{ event: string; data: any }> = [];
const previousBroadcast = (global as any).broadcastUpdate;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const point = (over: Record<string, unknown> = {}) => ({
  clientPointId: randomUUID(), recordedAt: minutesAgo(1), lat: 4.05, lng: 9.7, accuracyM: 8, speedKmh: 40, heading: 90, ...over,
});

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "gps=on";
  (global as any).broadcastUpdate = (event: string, data: unknown) => broadcasts.push({ event, data });
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const mk = async (actor: Actor) => {
    const [d] = await db.insert(drivers).values({ userId: session.userIdOf(actor), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any).returning();
    driverIds.push(d.id);
    return d.id;
  };
  driverAId = await mk("driverA");
  await mk("driverB");
  const vehicle = await createTestVehicle({});
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const mission = async (status: string, startedMinAgo: number | null) => {
    const [m] = await db.insert(missions).values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any).returning();
    missionIds.push(m.id);
    await db.insert(assignments).values({
      missionId: m.id, vehicleId: vehicle.id, driverId: driverAId, status: startedMinAgo === null ? "accepted" : "in_progress",
      ...(startedMinAgo === null ? {} : { startedAt: new Date(Date.now() - startedMinAgo * 60_000) }),
    } as any);
    return m.id;
  };
  missionId = await mission("in_progress", 30);
  waitingMissionId = await mission("assigned", null);
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (missionIds.length > 0) {
    await db.delete(vehiclePositions).where(inArray(vehiclePositions.missionId, missionIds));
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("ingestion par paquets", { timeout: 120000 }, () => {
  it("le chauffeur de la mission dépose un paquet, le rejeu est un succès sans doublon, temps réel émis", async () => {
    resetVehiclePositionBroadcasts();
    broadcasts.length = 0;
    const batch = { points: [point({ recordedAt: minutesAgo(3) }), point({ recordedAt: minutesAgo(2), lat: 4.051 })] };
    const first = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { actor: "driverA", body: batch });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ accepted: 2, duplicates: 0, rejected: 0 });
    expect(broadcasts.filter((b) => b.event === "vehicle_position_updated")).toHaveLength(1);
    expect(broadcasts[0].data).toMatchObject({ vehicleId, missionId });

    const replay = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { actor: "driverA", body: batch });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 2 });
    const rows = await db.select().from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "phone" && r.driverId === driverAId)).toBe(true);
  });

  it("paquet d'un autre propriétaire (X-Offline-Owner) : 409 OFFLINE_OWNER_MISMATCH, rien d'écrit ; propriétaire correct : accepté", async () => {
    const own = String(session.userIdOf("driverA"));
    const batch = { points: [point({ recordedAt: minutesAgo(5), lat: 4.07 })] };
    const url = `/api/driver/missions/${missionId}/positions`;
    const before = (await db.select().from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId))).length;
    const foreign = await session.call("POST", url, { actor: "driverA", body: batch, headers: { "X-Offline-Owner": String(Number(own) + 1) } });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(409);
    expect(foreign.body).toMatchObject({ code: "OFFLINE_OWNER_MISMATCH" });
    const after = await db.select().from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId));
    expect(after).toHaveLength(before);
    const mine = await session.call("POST", url, { actor: "driverA", body: batch, headers: { "X-Offline-Owner": own } });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
  });

  it("refuse futur, trop ancien et hors fenêtre de mission", async () => {
    const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, {
      actor: "driverA",
      body: { points: [point({ recordedAt: new Date(Date.now() + 3_600_000).toISOString() }), point({ recordedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }), point({ recordedAt: minutesAgo(120) })] },
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(0);
    expect(res.body.rejections.map((r: any) => r.reason).sort()).toEqual(["future", "out_of_window", "too_old"]);
  });

  it("marque un saut aberrant comme suspect", async () => {
    const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, {
      actor: "driverA",
      body: { points: [point({ recordedAt: minutesAgo(1), lat: 30, lng: 30 })] },
    });
    expect(res.status).toBe(201);
    expect(res.body.suspect).toBe(1);
  });

  it("valeurs invalides : 400 lisible (cap, latitude, paquet vide, trop gros)", async () => {
    for (const points of [[point({ lat: 95 })], [point({ heading: 400 })], [], Array.from({ length: 51 }, () => point())]) {
      const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { actor: "driverA", body: { points } });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/violates|constraint|syntax/i);
    }
  });

  it("autre chauffeur, personnel et client : 403 ; mission non partie : 409 ; sans session : 401", async () => {
    const body = { points: [point()] };
    for (const actor of ["driverB", "admin", "logistics", "client", "workshop"] as Actor[]) {
      const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { actor, body });
      expect(res.status, actor).toBe(403);
    }
    const waiting = await session.call("POST", `/api/driver/missions/${waitingMissionId}/positions`, { actor: "driverA", body });
    expect(waiting.status).toBe(409);
    const anon = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { body });
    expect(anon.status).toBe(401);
  });

  it("drapeau coupé : 404", async () => {
    process.env.FEATURE_FLAGS = "gps=off";
    try {
      const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, { actor: "driverA", body: { points: [point()] } });
      expect(res.status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "gps=on";
    }
  });
});

describe("format OsmAnd / Traccar Client", { timeout: 120000 }, () => {
  const postRaw = (path: string, contentType: string | null, body: string, actor: Actor = "driverA") =>
    fetch(session.baseUrl + path, {
      method: "POST",
      headers: { ...(contentType ? { "Content-Type": contentType } : {}), Cookie: session.cookies.get(actor)! },
      body,
    });
  const positionCount = async () => (await db.select().from(vehiclePositions).where(eq(vehiclePositions.missionId, missionId))).length;

  it("POST JSON (Traccar Client et OsmAnd à plat), vitesse convertie, rejeu sans doublon", async () => {
    const ts = Math.floor((Date.now() - 90_000) / 1000);
    const flat = { id: "tel1", lat: 4.06, lon: 9.71, timestamp: ts, speed: 10, bearing: 180, accuracy: 12 };
    const first = await session.call("POST", "/api/driver/positions", { actor: "driverA", body: flat });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.accepted).toBe(1);
    const again = await session.call("POST", "/api/driver/positions", { actor: "driverA", body: flat });
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
    const [row] = await db.select().from(vehiclePositions).where(eq(vehiclePositions.lat, 4.06));
    expect(row.speedKmh).toBeCloseTo(18.52, 1);

    const json = await session.call("POST", "/api/driver/positions", {
      actor: "driverA",
      body: { location: { timestamp: new Date(Date.now() - 80_000).toISOString(), coords: { latitude: 4.07, longitude: 9.72, speed: 5, heading: 360, accuracy: 9 } } },
    });
    expect(json.status, JSON.stringify(json.body)).toBe(200);
    expect(json.body.accepted).toBe(1);
  });

  it("B1 CSRF : GET d'écriture supprimé (404), formulaire ou texte (415), aucune ligne écrite", async () => {
    const before = await positionCount();
    const ts = Math.floor(Date.now() / 1000);
    const get = await session.call("GET", `/api/driver/positions?id=x&lat=4.5&lon=9.5&timestamp=${ts}`, { actor: "driverA" });
    expect(get.status).toBe(404);
    const form = await postRaw("/api/driver/positions", "application/x-www-form-urlencoded", `lat=4.5&lon=9.5&timestamp=${ts}`);
    expect(form.status).toBe(415);
    const query = await postRaw(`/api/driver/positions?lat=4.5&lon=9.5&timestamp=${ts}`, "application/x-www-form-urlencoded", "");
    expect(query.status).toBe(415);
    const text = await postRaw("/api/driver/positions", "text/plain", JSON.stringify({ lat: 4.5, lon: 9.5, timestamp: ts }));
    expect(text.status).toBe(415);
    const none = await postRaw("/api/driver/positions", null, "");
    expect(none.status).toBe(415);
    const batchForm = await postRaw(`/api/driver/missions/${missionId}/positions`, "application/x-www-form-urlencoded", "points=1");
    expect(batchForm.status).toBe(415);
    // La requête n'est plus lue : un POST JSON sans corps utile reste illisible (400), jamais une écriture.
    const queryOnly = await postRaw(`/api/driver/positions?lat=4.5&lon=9.5&timestamp=${ts}`, "application/json", "{}");
    expect(queryOnly.status).toBe(400);
    expect(await positionCount()).toBe(before);
  });

  it("illisible : 400 (date hors bornes comprise, jamais 500) ; relevé bruité accepté ; non chauffeur : 403", async () => {
    expect((await session.call("POST", "/api/driver/positions", { actor: "driverA", body: { id: "x" } })).status).toBe(400);
    expect((await session.call("POST", "/api/driver/positions", { actor: "driverA", body: { lat: 4, lon: 9, timestamp: "9".repeat(30) } })).status).toBe(400);
    expect((await session.call("POST", "/api/driver/positions", { actor: "driverA", body: { lat: 95, lon: 9, timestamp: Math.floor(Date.now() / 1000) } })).status).toBe(400);
    const wild = await session.call("POST", "/api/driver/positions", { actor: "driverA", body: { lat: 4.5, lon: 9.5, timestamp: Math.floor(Date.now() / 1000) - 30, accuracy: 1e12, bearing: 359.999999 } });
    expect(wild.status, JSON.stringify(wild.body)).toBe(200);
    expect((await session.call("POST", "/api/driver/positions", { actor: "admin", body: { lat: 4, lon: 9, timestamp: Math.floor(Date.now() / 1000) } })).status).toBe(403);
  });

  it("paquet : cap 359.999999 accepté, jamais refusé en bloc", async () => {
    const res = await session.call("POST", `/api/driver/missions/${missionId}/positions`, {
      actor: "driverA",
      body: { points: [point({ recordedAt: minutesAgo(0.5), lat: 4.052, heading: 359.999999 })] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = await db.select().from(vehiclePositions).where(eq(vehiclePositions.lat, 4.052));
    expect(row.heading).toBe(0);
  });
});

describe("mission à plusieurs affectations (B2)", { timeout: 120000 }, () => {
  let relayMissionId = 0;
  let vehicle2Id = 0;

  beforeAll(async () => {
    const vehicle2 = await createTestVehicle({});
    ids.vehicleIds.push(vehicle2.id);
    vehicle2Id = vehicle2.id;
    const [m] = await db.insert(missions).values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any).returning();
    relayMissionId = m.id;
    missionIds.push(m.id);
    const [driverB] = await db.select().from(drivers).where(eq(drivers.userId, session.userIdOf("driverB")));
    const startedAt = new Date(Date.now() - 30 * 60_000);
    await db.insert(assignments).values([
      { missionId: m.id, vehicleId, driverId: driverAId, status: "in_progress", startedAt },
      { missionId: m.id, vehicleId: vehicle2.id, driverId: driverB.id, status: "in_progress", startedAt },
    ] as any);
  });

  it("la trace lue par A ne contient aucun point de B ; un point de B à 100 km au même instant n'est pas suspect", async () => {
    const at = minutesAgo(2);
    const a = await session.call("POST", `/api/driver/missions/${relayMissionId}/positions`, { actor: "driverA", body: { points: [point({ recordedAt: at, lat: 4.0, lng: 9.7 })] } });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const b = await session.call("POST", `/api/driver/missions/${relayMissionId}/positions`, { actor: "driverB", body: { points: [point({ recordedAt: at, lat: 4.9, lng: 9.7 })] } });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.suspect).toBe(0);

    const trackA = await session.call("GET", `/api/missions/${relayMissionId}/track`, { actor: "driverA" });
    expect(trackA.status).toBe(200);
    expect(trackA.body.points).toHaveLength(1);
    expect(trackA.body.points[0]).toMatchObject({ vehicleId, lat: 4.0, suspect: false });
    const trackB = await session.call("GET", `/api/missions/${relayMissionId}/track`, { actor: "driverB" });
    expect(trackB.body.points.map((p: any) => p.vehicleId)).toEqual([vehicle2Id]);
    const staff = await session.call("GET", `/api/missions/${relayMissionId}/track`, { actor: "logistics" });
    expect(staff.body.points.map((p: any) => p.vehicleId).sort()).toEqual([vehicleId, vehicle2Id].sort());
  });
});

describe("plafond de points par mission", { timeout: 120000 }, () => {
  it("au-delà de 50 000 points par chauffeur et par mission : 409 lisible, définitif", async () => {
    const [m] = await db.insert(missions).values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any).returning();
    missionIds.push(m.id);
    await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId: driverAId, status: "in_progress", startedAt: new Date(Date.now() - 30 * 60_000) } as any);
    await db.execute(sql`
      INSERT INTO vehicle_positions (vehicle_id, mission_id, driver_id, source, submitted_by, client_point_id, recorded_at, lat, lng)
      SELECT ${vehicleId}, ${m.id}, ${driverAId}, 'phone', ${session.userIdOf("driverA")}, gen_random_uuid(), now() - (g * interval '1 second') - interval '10 minutes', 4.05, 9.7
      FROM generate_series(1, 50000) g`);
    const res = await session.call("POST", `/api/driver/missions/${m.id}/positions`, { actor: "driverA", body: { points: [point()] } });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body).toMatchObject({ code: "GPS_MISSION_CAP_REACHED" });
    expect(JSON.stringify(res.body)).not.toMatch(/violates|constraint|syntax/i);
  });

  it("le rejeu d'un paquet au plafond répond « doublons » (200), pas d'erreur ; seul un point nouveau est refusé", async () => {
    const [m] = await db.insert(missions).values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any).returning();
    missionIds.push(m.id);
    await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId: driverAId, status: "in_progress", startedAt: new Date(Date.now() - 30 * 60_000) } as any);
    const known = point({ recordedAt: minutesAgo(5) });
    await db.execute(sql`
      INSERT INTO vehicle_positions (vehicle_id, mission_id, driver_id, source, submitted_by, client_point_id, recorded_at, lat, lng)
      SELECT ${vehicleId}, ${m.id}, ${driverAId}, 'phone', ${session.userIdOf("driverA")}, gen_random_uuid(), now() - (g * interval '1 second') - interval '10 minutes', 4.05, 9.7
      FROM generate_series(1, 49999) g`);
    await db.execute(sql`
      INSERT INTO vehicle_positions (vehicle_id, mission_id, driver_id, source, submitted_by, client_point_id, recorded_at, lat, lng)
      VALUES (${vehicleId}, ${m.id}, ${driverAId}, 'phone', ${session.userIdOf("driverA")}, ${known.clientPointId}::uuid, ${known.recordedAt}::timestamptz, 4.05, 9.7)`);

    const replay = await session.call("POST", `/api/driver/missions/${m.id}/positions`, { actor: "driverA", body: { points: [known, known] } });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({ accepted: 0, duplicates: 2 });
    const mixed = await session.call("POST", `/api/driver/missions/${m.id}/positions`, { actor: "driverA", body: { points: [known, point()] } });
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(409);
    expect(mixed.body).toMatchObject({ code: "GPS_MISSION_CAP_REACHED" });
  });
});

describe("mission annulée en route", { timeout: 120000 }, () => {
  it("points relevés avant l'annulation (+ 2 min) acceptés, après rejetés ; chauffeur retiré d'une mission qui continue : 403", async () => {
    const mk = async (missionStatus: string, assignmentStatus: string, cancelledMinAgo: number | null) => {
      const [m] = await db.insert(missions).values({
        orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: missionStatus,
        ...(cancelledMinAgo === null ? {} : { cancelledAt: new Date(Date.now() - cancelledMinAgo * 60_000) }),
      } as any).returning();
      missionIds.push(m.id);
      await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId: driverAId, status: assignmentStatus, startedAt: new Date(Date.now() - 40 * 60_000) } as any);
      return m.id;
    };
    const cancelledId = await mk("cancelled", "cancelled", 10);
    const before = await session.call("POST", `/api/driver/missions/${cancelledId}/positions`, { actor: "driverA", body: { points: [point({ recordedAt: minutesAgo(15) }), point({ recordedAt: minutesAgo(9) })] } });
    expect(before.status, JSON.stringify(before.body)).toBe(201);
    expect(before.body).toMatchObject({ accepted: 2, rejected: 0 });
    const after = await session.call("POST", `/api/driver/missions/${cancelledId}/positions`, { actor: "driverA", body: { points: [point({ recordedAt: minutesAgo(5) })] } });
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body).toMatchObject({ accepted: 0, rejected: 1 });
    expect(after.body.rejections[0].reason).toBe("out_of_window");
    const other = await session.call("POST", `/api/driver/missions/${cancelledId}/positions`, { actor: "driverB", body: { points: [point({ recordedAt: minutesAgo(15) })] } });
    expect(other.status).toBe(403);

    const removedId = await mk("in_progress", "cancelled", null);
    const removed = await session.call("POST", `/api/driver/missions/${removedId}/positions`, { actor: "driverA", body: { points: [point()] } });
    expect(removed.status).toBe(403);
  });
});

describe("lecture : dernière position et trace", { timeout: 120000 }, () => {
  it("dernière position : chef d'atelier, logistique, direction, admin oui ; chauffeur, client, magasin 403", async () => {
    for (const actor of ["workshop", "logistics", "management", "admin"] as Actor[]) {
      const res = await session.call("GET", "/api/vehicle-positions", { actor });
      expect(res.status, actor).toBe(200);
      const mine = res.body.find((r: any) => r.vehicleId === vehicleId);
      expect(mine).toBeTruthy();
      expect(mine.lat).not.toBe(30);
    }
    for (const actor of ["driverA", "client", "warehouse"] as Actor[]) {
      expect((await session.call("GET", "/api/vehicle-positions", { actor })).status, actor).toBe(403);
    }
    expect((await session.call("GET", `/api/vehicle-positions/${vehicleId}`, { actor: "workshop" })).status).toBe(200);
    expect((await session.call("GET", "/api/vehicle-positions/999999999", { actor: "admin" })).status).toBe(404);
  });

  it("trace : logistique, direction, admin et chauffeur de la mission ; pas le chef d'atelier, ni autre chauffeur, ni client", async () => {
    for (const actor of ["logistics", "management", "admin", "driverA"] as Actor[]) {
      const res = await session.call("GET", `/api/missions/${missionId}/track`, { actor });
      expect(res.status, actor).toBe(200);
      expect(res.body.points.length).toBeGreaterThanOrEqual(4);
      expect(res.body.points.some((p: any) => p.suspect === true)).toBe(true);
    }
    for (const actor of ["workshop", "driverB", "client", "warehouse"] as Actor[]) {
      expect((await session.call("GET", `/api/missions/${missionId}/track`, { actor })).status, actor).toBe(403);
    }
    expect((await session.call("GET", "/api/missions/999999999/track", { actor: "admin" })).status).toBe(404);
  });
});

describe("points A/B des missions", { timeout: 120000 }, () => {
  it("PATCH /geo : hub valide (coordonnées du hub), point libre, effacement ; hub inconnu et demi-point 400 ; rôles", async () => {
    broadcasts.length = 0;
    const hub = await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "logistics", body: { pickup: { hubCode: "douala" }, delivery: { lat: 3.87, lng: 11.52 } } });
    expect(hub.status, JSON.stringify(hub.body)).toBe(200);
    const updated = broadcasts.filter((b) => b.event === "mission_updated");
    expect(updated.length).toBeGreaterThanOrEqual(1);
    expect(updated[0].data).toMatchObject({ entity: "mission", entityId: missionId, payload: { missionId } });
    expect(hub.body.pickupHubCode).toBe("douala");
    expect(hub.body.pickupLat).toBeCloseTo(4.0511);
    const [row] = await db.select().from(missions).where(eq(missions.id, missionId));
    expect(row.deliveryLat).toBeCloseTo(3.87);
    expect(row.deliveryHubCode).toBeNull();

    expect((await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "admin", body: { pickup: { hubCode: "inconnu" } } })).status).toBe(400);
    expect((await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "admin", body: { delivery: { lat: 3.87 } } })).status).toBe(400);
    expect((await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "admin", body: { delivery: { lat: 120, lng: 10 } } })).status).toBe(400);
    expect((await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "admin", body: { delivery: null } })).status).toBe(200);
    for (const actor of ["workshop", "management", "driverA", "client"] as Actor[]) {
      expect((await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor, body: { delivery: null } })).status, actor).toBe(403);
    }
  });

  it("POST /api/missions : hub connu écrit les coordonnées du hub, point libre conservé", async () => {
    const orderNumber = uniqueTestToken("MIS");
    const res = await session.call("POST", "/api/missions", {
      actor: "logistics",
      body: { orderNumber, pickupAddress: "TEST A", deliveryAddress: "TEST B", missionType: "delivery", pickupHubCode: "douala", deliveryLat: 3.87, deliveryLng: 11.52 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    missionIds.push(res.body.id);
    const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(row.pickupHubCode).toBe("douala");
    expect(row.pickupLat).toBeCloseTo(4.0511);
    expect(row.deliveryLat).toBeCloseTo(3.87);
    expect(row.deliveryHubCode).toBeNull();
  });

  it("POST /api/missions : hub inconnu refusé avant écriture", async () => {
    const res = await session.call("POST", "/api/missions", {
      actor: "logistics",
      body: { orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", missionType: "delivery", pickupHubCode: "inconnu" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Hub/);
  });
});

describe("points A/B : drapeau coupé", { timeout: 120000 }, () => {
  it("POST /api/missions ignore les champs géo (aucune écriture, aucun refus de hub)", async () => {
    process.env.FEATURE_FLAGS = "gps=off";
    try {
      const res = await session.call("POST", "/api/missions", {
        actor: "logistics",
        body: { orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", missionType: "delivery", pickupHubCode: "inconnu", deliveryLat: 3.87, deliveryLng: 11.52 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      missionIds.push(res.body.id);
      const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
      expect(row.pickupHubCode).toBeNull();
      expect(row.deliveryLat).toBeNull();
    } finally {
      process.env.FEATURE_FLAGS = "gps=on";
    }
  });
});
