import { describe, expect, it, vi } from "vitest";
import {
  classifyPoints,
  gpsBatchSchema,
  gpsCheckAppError,
  haversineKm,
  missionGeoColumnsFromBody,
  parseOsmandReport,
  resolveMissionGeoPoint,
  suspectPointIds,
  toGpsPoint,
  type GpsPoint,
} from "../../../server/lib/gps-points";
import { POSITION_BROADCAST_MIN_INTERVAL_MS, broadcastVehiclePositionUpdated, resetVehiclePositionBroadcasts } from "../../../server/lib/vehicle-position-realtime";
import { runGpsPositionsPurge } from "../../../server/jobs/gps-positions-purge";

const NOW = new Date("2026-11-10T12:00:00Z");
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const pt = (id: string, iso: string, lat = 4.05, lng = 9.7): GpsPoint => ({ clientPointId: id, recordedAt: new Date(iso), lat, lng, accuracyM: null, speedKmh: null, heading: null });
const WINDOW = { startedAt: new Date("2026-11-10T10:00:00Z"), endedAt: null };

describe("classifyPoints", () => {
  it("accepte dans la fenêtre, refuse futur, trop ancien et hors fenêtre", () => {
    const { accepted, rejected } = classifyPoints(
      [pt("a", "2026-11-10T11:59:00Z"), pt("b", "2026-11-10T13:00:00Z"), pt("c", "2026-09-01T00:00:00Z"), pt("d", "2026-11-10T09:00:00Z")],
      { now: NOW, window: WINDOW, retentionDays: 30 },
    );
    expect(accepted.map((p) => p.clientPointId)).toEqual(["a"]);
    expect(rejected).toEqual([
      { clientPointId: "b", reason: "future" },
      { clientPointId: "c", reason: "too_old" },
      { clientPointId: "d", reason: "out_of_window" },
    ]);
  });

  it("après livraison, un envoi hors ligne tardif reste accepté jusqu'à la fin de l'affectation + marge", () => {
    const window = { startedAt: WINDOW.startedAt, endedAt: new Date("2026-11-10T11:00:00Z") };
    const { accepted, rejected } = classifyPoints([pt("a", "2026-11-10T10:59:00Z"), pt("b", "2026-11-10T11:30:00Z")], { now: NOW, window, retentionDays: 30 });
    expect(accepted).toHaveLength(1);
    expect(rejected[0].reason).toBe("out_of_window");
  });
});

describe("suspectPointIds", () => {
  it("marque un saut à plus de 200 km/h, pas un trajet normal", () => {
    const prev = { lat: 4.05, lng: 9.7, recordedAt: new Date("2026-11-10T11:00:00Z") };
    const ok = pt("ok", "2026-11-10T11:01:00Z", 4.06, 9.7);
    const jump = pt("jump", "2026-11-10T11:02:00Z", 30, 30);
    expect([...suspectPointIds(prev, [jump, ok])]).toEqual(["jump"]);
    expect(suspectPointIds(null, [ok]).size).toBe(0);
  });
  it("haversine : Douala-Yaoundé autour de 200 km", () => {
    expect(haversineKm({ lat: 4.0511, lng: 9.7679 }, { lat: 3.848, lng: 11.5021 })).toBeGreaterThan(180);
  });
});

describe("paquet JSON", () => {
  const valid = { clientPointId: U1, recordedAt: "2026-11-10T11:00:00Z", lat: 4, lng: 9 };
  it("refuse vide, plus de 50 points, latitude hors bornes, cap 360", () => {
    expect(gpsBatchSchema.safeParse({ points: [] }).success).toBe(false);
    expect(gpsBatchSchema.safeParse({ points: Array.from({ length: 51 }, () => valid) }).success).toBe(false);
    expect(gpsBatchSchema.safeParse({ points: [{ ...valid, lat: 91 }] }).success).toBe(false);
    expect(gpsBatchSchema.safeParse({ points: [{ ...valid, heading: 360 }] }).success).toBe(false);
    expect(gpsBatchSchema.safeParse({ points: [valid] }).success).toBe(true);
  });
  it("toGpsPoint complète les champs absents par null", () => {
    expect(toGpsPoint(gpsBatchSchema.parse({ points: [valid] }).points[0])).toMatchObject({ accuracyM: null, speedKmh: null, heading: null });
  });
});

describe("contraintes de base", () => {
  it("23514 connu : AppError 400 lisible ; inconnu : null", () => {
    const e = gpsCheckAppError("vehicle_positions_coords_check", new Error("sql"));
    expect(e?.status).toBe(400);
    expect(e?.message).toBe("Position GPS invalide.");
    expect(gpsCheckAppError("autre", new Error("x"))).toBeNull();
  });
});

describe("format OsmAnd / Traccar Client", () => {
  const ctx = { now: NOW, userId: 7, missionId: 3 };
  it("requête : vitesse en nœuds, horodatage en secondes", () => {
    const p = parseOsmandReport({ id: "t", lat: "4.06", lon: "9.71", timestamp: "1762776000", speed: "10", bearing: "180", accuracy: "12" }, undefined, ctx)!;
    expect(p.speedKmh).toBeCloseTo(18.52, 2);
    expect(p.recordedAt.toISOString()).toBe("2025-11-10T12:00:00.000Z");
    expect(p.heading).toBe(180);
    expect(p.accuracyM).toBe(12);
  });
  it("JSON : vitesse en m/s, cap 360 ramené à 0, -1 = inconnu", () => {
    const p = parseOsmandReport({}, { location: { timestamp: "2026-11-10T11:59:00Z", coords: { latitude: 4, longitude: 9, speed: 10, heading: 360 } } }, ctx)!;
    expect(p.speedKmh).toBeCloseTo(36, 5);
    expect(p.heading).toBe(0);
    const q = parseOsmandReport({}, { location: { timestamp: "2026-11-10T11:59:00Z", coords: { latitude: 4, longitude: 9, speed: -1, heading: -1 } } }, ctx)!;
    expect(q.speedKmh).toBeNull();
    expect(q.heading).toBeNull();
  });
  it("identifiant dérivé stable (rejeu = même point) et propre à l'utilisateur", () => {
    const q = { lat: "4", lon: "9", timestamp: "1762776000" };
    const a = parseOsmandReport(q, undefined, ctx)!;
    expect(parseOsmandReport(q, undefined, ctx)!.clientPointId).toBe(a.clientPointId);
    expect(parseOsmandReport(q, undefined, { ...ctx, userId: 8 })!.clientPointId).not.toBe(a.clientPointId);
    expect(a.clientPointId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("sans latitude ou longitude : null", () => {
    expect(parseOsmandReport({ lat: "4" }, undefined, ctx)).toBeNull();
  });
});

describe("points A/B des missions", () => {
  it("hub connu : coordonnées du hub, quelles que soient celles envoyées", () => {
    const p = resolveMissionGeoPoint("pickup", { hubCode: "douala", lat: 1, lng: 1 });
    expect(p.hubCode).toBe("douala");
    expect(p.lat).toBeCloseTo(4.0511);
  });
  it("hub inconnu (y compris clé du prototype) : 400", () => {
    for (const hubCode of ["inconnu", "__proto__", "constructor"]) {
      expect(() => resolveMissionGeoPoint("delivery", { hubCode })).toThrow(/Hub d'arrivée inconnu/);
    }
  });
  it("demi-point ou hors bornes : 400 ; aucun : null/null", () => {
    expect(() => resolveMissionGeoPoint("pickup", { lat: 4 })).toThrow(/incomplet/);
    expect(() => resolveMissionGeoPoint("pickup", { lat: 95, lng: 9 })).toThrow(/incomplet/);
    expect(resolveMissionGeoPoint("pickup", {})).toEqual({ lat: null, lng: null, hubCode: null });
  });
  it("colonnes d'un corps : seuls les points présents sont écrits", () => {
    expect(missionGeoColumnsFromBody({ orderNumber: "x" })).toEqual({});
    expect(missionGeoColumnsFromBody({ deliveryLat: 3, deliveryLng: 11 })).toEqual({ deliveryLat: 3, deliveryLng: 11, deliveryHubCode: null });
    expect(missionGeoColumnsFromBody({ pickupHubCode: null })).toEqual({ pickupLat: null, pickupLng: null, pickupHubCode: null });
  });
});

describe("diffusion temps réel anti-tempête", () => {
  it("une diffusion par véhicule et par fenêtre de 30 s", () => {
    const sent: Array<[string, any]> = [];
    (global as any).broadcastUpdate = (e: string, d: unknown) => sent.push([e, d]);
    resetVehiclePositionBroadcasts();
    expect(broadcastVehiclePositionUpdated(1, 5, undefined, NOW)).toBe(true);
    expect(broadcastVehiclePositionUpdated(1, 5, undefined, new Date(NOW.getTime() + 1000))).toBe(false);
    expect(broadcastVehiclePositionUpdated(2, 5, undefined, new Date(NOW.getTime() + 1000))).toBe(true);
    expect(broadcastVehiclePositionUpdated(1, 5, undefined, new Date(NOW.getTime() + POSITION_BROADCAST_MIN_INTERVAL_MS))).toBe(true);
    expect(sent).toHaveLength(3);
    expect(sent[0][0]).toBe("vehicle_position_updated");
    expect(sent[0][1]).toMatchObject({ vehicleId: 1, missionId: 5 });
    delete (global as any).broadcastUpdate;
  });
});

describe("purge quotidienne", () => {
  it("drapeau coupé : aucune requête ; allumé : appelle la fonction avec la rétention configurée", async () => {
    const query = vi.fn(async () => ({ rows: [{ deleted: 4 }] }));
    const deps = { isEnabled: () => false, retentionDays: () => 30, client: async () => ({ query }) };
    expect(await runGpsPositionsPurge(deps)).toBe("disabled");
    expect(query).not.toHaveBeenCalled();
    expect(await runGpsPositionsPurge({ ...deps, isEnabled: () => true, retentionDays: () => 45 })).toEqual({ purged: 4, retentionDays: 45 });
    expect(query).toHaveBeenCalledWith("SELECT purge_vehicle_positions($1) AS deleted", [45]);
  });
});
