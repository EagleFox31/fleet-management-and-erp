import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
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
  it("GET en query (vitesse en nœuds) et POST JSON, rejeu sans doublon", async () => {
    const ts = Math.floor((Date.now() - 90_000) / 1000);
    const url = `/api/driver/positions?id=tel1&lat=4.06&lon=9.71&timestamp=${ts}&speed=10&bearing=180&accuracy=12`;
    const get = await session.call("GET", url, { actor: "driverA" });
    expect(get.status, JSON.stringify(get.body)).toBe(200);
    expect(get.body.accepted).toBe(1);
    const again = await session.call("GET", url, { actor: "driverA" });
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

  it("illisible : 400 ; non chauffeur : 403", async () => {
    expect((await session.call("GET", "/api/driver/positions?id=x", { actor: "driverA" })).status).toBe(400);
    expect((await session.call("GET", `/api/driver/positions?lat=4&lon=9&timestamp=${Math.floor(Date.now() / 1000)}`, { actor: "admin" })).status).toBe(403);
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
    const hub = await session.call("PATCH", `/api/missions/${missionId}/geo`, { actor: "logistics", body: { pickup: { hubCode: "douala" }, delivery: { lat: 3.87, lng: 11.52 } } });
    expect(hub.status, JSON.stringify(hub.body)).toBe(200);
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
