/**
 * Positions GPS des véhicules (GPS V1 téléphone) : ingestion par le chauffeur de la mission,
 * dernière position par véhicule, trace d'une mission. Les invariants de donnée sont tenus par la
 * base (docs/analysis/GPS_V1_POSITIONS_BASE.md) ; ce service porte ce qui dépend de la mission
 * (appartenance, fenêtre de route) et traduit les refus de contrainte en `AppError`.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assignments, missions, vehiclePositions } from "@shared/schema";
import { AppError } from "../lib/app-error";
import { driverLiveAssignmentFilter, driverScopeOf, OUT_OF_DRIVER_SCOPE_MESSAGE } from "../lib/driver-scope";
import {
  classifyPoints,
  gpsCheckAppError,
  suspectPointIds,
  type GpsPoint,
  type GpsRejection,
} from "../lib/gps-points";
import { isCheckViolation, pgConstraintOf } from "../lib/pg-errors";
import { broadcastVehiclePositionUpdated } from "../lib/vehicle-position-realtime";

/** Points au plus par chauffeur et par mission (1 point / 5 s pendant 14 h = 10 000 ; marge pour un long trajet). */
export const GPS_MISSION_POINTS_CAP = 50_000;

export type PositionActor = { id: number; role: string };

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: number;
  rejections: GpsRejection[];
  suspect: number;
};

/** Statuts de mission pendant lesquels un relevé est recevable (le hors ligne arrive après la livraison). */
const RECORDABLE_MISSION_STATUSES = ["in_progress", "delivered", "completed", "cancelled"] as const;

type MissionRoute = {
  missionId: number;
  vehicleId: number;
  driverId: number;
  startedAt: Date;
  endedAt: Date | null;
  missionStatus: string;
};

/**
 * Chauffeur et mission : le compte est un chauffeur, affecté (affectation vivante) à cette mission.
 * Tout autre cas est un 403, mission inexistante comprise (rien ne fuit sur l'existence d'un numéro).
 */
async function routeOfDriverMission(actor: PositionActor, missionId: number): Promise<MissionRoute> {
  if (actor.role !== "driver") throw new AppError(403, "Accès refusé : réservé au chauffeur de la mission.");
  const driverIds = await driverScopeOf(actor);
  if (!driverIds || driverIds.length === 0) throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
  const [live] = await db
    .select({
      vehicleId: assignments.vehicleId,
      driverId: assignments.driverId,
      startedAt: assignments.startedAt,
      endedAt: assignments.completedAt,
      missionStatus: missions.status,
    })
    .from(assignments)
    .innerJoin(missions, eq(missions.id, assignments.missionId))
    .where(and(eq(assignments.missionId, missionId), driverLiveAssignmentFilter(driverIds)))
    .orderBy(desc(assignments.startedAt), desc(assignments.id))
    .limit(1);
  let row = live;
  if (!row) {
    // Mission annulée en route : l'annulation passe les affectations à « cancelled », donc hors périmètre
    // vivant. Les points relevés avant l'annulation (+ marge, plan §6) restent recevables : le trajet a eu lieu.
    // Un chauffeur retiré d'une mission qui continue (affectation annulée seule) reste en 403.
    const [cancelled] = await db
      .select({
        vehicleId: assignments.vehicleId,
        driverId: assignments.driverId,
        startedAt: assignments.startedAt,
        endedAt: missions.cancelledAt,
        missionStatus: missions.status,
      })
      .from(assignments)
      .innerJoin(missions, eq(missions.id, assignments.missionId))
      .where(and(
        eq(assignments.missionId, missionId),
        inArray(assignments.driverId, driverIds),
        eq(assignments.status, "cancelled"),
        eq(missions.status, "cancelled"),
        isNotNull(missions.cancelledAt),
        isNotNull(assignments.startedAt),
      ))
      .orderBy(desc(assignments.startedAt), desc(assignments.id))
      .limit(1);
    row = cancelled;
  }
  if (!row) throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
  if (!(RECORDABLE_MISSION_STATUSES as readonly string[]).includes(row.missionStatus) || !row.startedAt) {
    throw new AppError(409, "La mission n'est pas en route : position non enregistrée.");
  }
  if (row.vehicleId == null || row.driverId == null) {
    throw new AppError(409, "Aucun véhicule n'est affecté à cette mission : position non enregistrée.");
  }
  return {
    missionId,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    missionStatus: row.missionStatus,
  };
}

/** Mission « en route » d'un chauffeur (Traccar Client ne connaît pas nos missions) : la plus récemment partie. */
export async function activeMissionIdOf(actor: PositionActor): Promise<number> {
  if (actor.role !== "driver") throw new AppError(403, "Accès refusé : réservé au chauffeur.");
  const driverIds = await driverScopeOf(actor);
  if (!driverIds || driverIds.length === 0) throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
  const [row] = await db
    .select({ missionId: assignments.missionId })
    .from(assignments)
    .innerJoin(missions, eq(missions.id, assignments.missionId))
    .where(and(driverLiveAssignmentFilter(driverIds), eq(missions.status, "in_progress"), isNotNull(assignments.startedAt)))
    .orderBy(desc(assignments.startedAt), desc(assignments.id))
    .limit(1);
  if (!row) throw new AppError(409, "Aucune mission en route : position non enregistrée.");
  return row.missionId;
}

export async function ingestDriverPositions(
  actor: PositionActor,
  missionId: number,
  points: readonly GpsPoint[],
  options: { requestId?: string; now?: Date } = {},
): Promise<IngestResult> {
  const route = await routeOfDriverMission(actor, missionId);
  const now = options.now ?? new Date();
  const { accepted, rejected } = classifyPoints(points, {
    now,
    window: { startedAt: route.startedAt, endedAt: route.endedAt },
  });
  const result: IngestResult = { accepted: 0, duplicates: 0, rejected: rejected.length, rejections: rejected, suspect: 0 };
  if (accepted.length === 0) return result;

  // Dernier point connu avant le premier du paquet : référence du saut aberrant.
  const earliest = new Date(Math.min(...accepted.map((p) => p.recordedAt.getTime())));
  const [previous] = await db
    .select({ lat: vehiclePositions.lat, lng: vehiclePositions.lng, recordedAt: vehiclePositions.recordedAt })
    .from(vehiclePositions)
    // Même véhicule : une mission à plusieurs affectations (A sur V1, puis B sur V2) ne compare pas
    // la position de B à celle de A, sinon un relais ferait passer le point de B pour un saut.
    .where(and(
      eq(vehiclePositions.missionId, missionId),
      eq(vehiclePositions.vehicleId, route.vehicleId),
      sql`${vehiclePositions.recordedAt} <= ${earliest.toISOString()}::timestamptz`,
    ))
    .orderBy(desc(vehiclePositions.recordedAt))
    .limit(1);
  const suspects = suspectPointIds(previous ?? null, accepted);

  // Plafond par chauffeur et par mission : un compte (ou un téléphone qui boucle) ne remplit pas la table.
  // Ne compte que les points nouveaux : doublons du paquet écartés, puis points déjà en base. Un rejeu
  // près du plafond répond « doublons », pas 429.
  const batch = new Map<string, GpsPoint>();
  for (const p of accepted) if (!batch.has(p.clientPointId)) batch.set(p.clientPointId, p);
  const known = await db
    .select({ id: vehiclePositions.clientPointId })
    .from(vehiclePositions)
    .where(and(
      eq(vehiclePositions.source, "phone"),
      eq(vehiclePositions.submittedBy, actor.id),
      inArray(vehiclePositions.clientPointId, [...batch.keys()]),
    ));
  const knownIds = new Set(known.map((r) => r.id));
  const fresh = [...batch.keys()].filter((id) => !knownIds.has(id)).length;
  if (fresh > 0) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(vehiclePositions)
      .where(and(eq(vehiclePositions.missionId, missionId), eq(vehiclePositions.driverId, route.driverId)));
    if (n + fresh > GPS_MISSION_POINTS_CAP) {
      throw new AppError(429, "Trop de positions enregistrées pour cette mission. Contactez la logistique.");
    }
  }

  const tuples = accepted.map(
    (p) => sql`(${route.vehicleId}, ${missionId}, ${route.driverId}, 'phone', ${actor.id}, ${p.clientPointId}::uuid, ${p.recordedAt.toISOString()}::timestamptz, ${p.lat}, ${p.lng}, ${p.accuracyM}, ${p.speedKmh}, ${p.heading}, ${suspects.has(p.clientPointId)})`,
  );
  let inserted: Array<{ client_point_id: string }>;
  try {
    // Rejeu sans doublon : la contrainte unique est l'arbitre, le doublon est un succès (hors ligne).
    const res = await db.execute(sql`
      INSERT INTO vehicle_positions
        (vehicle_id, mission_id, driver_id, source, submitted_by, client_point_id, recorded_at, lat, lng, accuracy_m, speed_kmh, heading, suspect)
      VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT ON CONSTRAINT vehicle_positions_client_point_unique DO NOTHING
      RETURNING client_point_id`);
    inserted = res.rows as Array<{ client_point_id: string }>;
  } catch (error) {
    if (isCheckViolation(error)) {
      const mapped = gpsCheckAppError(pgConstraintOf(error), error);
      if (mapped) throw mapped;
    }
    throw error;
  }

  const insertedIds = new Set(inserted.map((r) => r.client_point_id));
  result.accepted = inserted.length;
  result.duplicates = accepted.length - inserted.length;
  result.suspect = accepted.filter((p) => insertedIds.has(p.clientPointId) && suspects.has(p.clientPointId)).length;
  if (inserted.length > 0) broadcastVehiclePositionUpdated(route.vehicleId, missionId, options.requestId, now);
  return result;
}

export type LastPositionRow = {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  missionId: number | null;
  orderNumber: string | null;
  missionStatus: string | null;
  source: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  recordedAt: string;
  ageSeconds: number;
};

/**
 * Dernière position retenue par véhicule (`LATERAL ... LIMIT 1` par véhicule, sur l'index `(vehicle_id, recorded_at DESC)`).
 * Un point marqué suspect n'est pas la « dernière position » : le précédent sert. Véhicule retiré
 * de la flotte (suppression douce) exclu. Sans trace : ni historique ni chauffeur.
 */
export async function lastVehiclePositions(options: { vehicleId?: number; maxAgeMinutes?: number } = {}): Promise<LastPositionRow[]> {
  const vehicleFilter = options.vehicleId !== undefined ? sql`AND v.id = ${options.vehicleId}` : sql``;
  const ageFilter = options.maxAgeMinutes !== undefined
    ? sql`AND vp.recorded_at >= now() - (${options.maxAgeMinutes}::int * interval '1 minute')`
    : sql``;
  const res = await db.execute(sql`
    SELECT
      v.id AS vehicle_id, v.registration_number, v.brand, v.model, vp.mission_id, m.order_number, m.status AS mission_status,
      vp.source, vp.lat, vp.lng, vp.accuracy_m, vp.speed_kmh, vp.heading, vp.recorded_at,
      extract(epoch FROM (now() - vp.recorded_at))::int AS age_seconds
    FROM vehicles v
    CROSS JOIN LATERAL (
      SELECT * FROM vehicle_positions vp
      WHERE vp.vehicle_id = v.id AND NOT vp.suspect ${ageFilter}
      ORDER BY vp.recorded_at DESC, vp.id DESC
      LIMIT 1
    ) vp
    LEFT JOIN missions m ON m.id = vp.mission_id
    WHERE v.deleted_at IS NULL ${vehicleFilter}
    ORDER BY vp.recorded_at DESC`);
  return (res.rows as Array<Record<string, any>>).map((r) => ({
    vehicleId: Number(r.vehicle_id),
    registrationNumber: r.registration_number,
    brand: r.brand,
    model: r.model,
    missionId: r.mission_id === null ? null : Number(r.mission_id),
    orderNumber: r.order_number ?? null,
    missionStatus: r.mission_status ?? null,
    source: r.source,
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    speedKmh: r.speed_kmh,
    heading: r.heading,
    recordedAt: new Date(r.recorded_at).toISOString(),
    ageSeconds: Math.max(0, Number(r.age_seconds)),
  }));
}

export const TRACK_MAX_POINTS = 5000;

export type MissionTrack = {
  missionId: number;
  status: string;
  pickup: { lat: number | null; lng: number | null; hubCode: string | null; address: string };
  delivery: { lat: number | null; lng: number | null; hubCode: string | null; address: string };
  points: Array<{ id: number; vehicleId: number; recordedAt: string; lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; heading: number | null; suspect: boolean }>;
  truncated: boolean;
};

/**
 * Trace d'une mission, points dans l'ordre du relevé (`since` pour compléter sans tout relire).
 * Cloison : le chauffeur ne lit que sa mission (affectation vivante) ; le personnel autorisé par la
 * route lit toute mission. Les points suspects sont renvoyés, marqués : l'écran décide de les tracer.
 */
export async function missionTrack(
  actor: PositionActor,
  missionId: number,
  options: { since?: Date; limit?: number } = {},
): Promise<MissionTrack> {
  let ownDriverIds: number[] | null = null;
  if (actor.role === "driver") {
    const driverIds = await driverScopeOf(actor);
    const own = driverIds && driverIds.length > 0
      ? await db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.missionId, missionId), driverLiveAssignmentFilter(driverIds))).limit(1)
      : [];
    if (own.length === 0) throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
    ownDriverIds = driverIds ?? null;
  }
  const [mission] = await db
    .select({
      id: missions.id,
      status: missions.status,
      pickupAddress: missions.pickupAddress,
      pickupLat: missions.pickupLat,
      pickupLng: missions.pickupLng,
      pickupHubCode: missions.pickupHubCode,
      deliveryAddress: missions.deliveryAddress,
      deliveryLat: missions.deliveryLat,
      deliveryLng: missions.deliveryLng,
      deliveryHubCode: missions.deliveryHubCode,
    })
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  if (!mission) throw new AppError(404, "Mission introuvable.");

  const limit = Math.min(Math.max(options.limit ?? TRACK_MAX_POINTS, 1), TRACK_MAX_POINTS);
  const conditions = [eq(vehiclePositions.missionId, missionId)];
  // Mission à plusieurs affectations : le chauffeur ne lit que les points relevés sous son identité.
  if (ownDriverIds) conditions.push(inArray(vehiclePositions.driverId, ownDriverIds));
  if (options.since) conditions.push(sql`${vehiclePositions.recordedAt} > ${options.since.toISOString()}::timestamptz`);
  const rows = await db
    .select({
      id: vehiclePositions.id,
      vehicleId: vehiclePositions.vehicleId,
      recordedAt: vehiclePositions.recordedAt,
      lat: vehiclePositions.lat,
      lng: vehiclePositions.lng,
      accuracyM: vehiclePositions.accuracyM,
      speedKmh: vehiclePositions.speedKmh,
      heading: vehiclePositions.heading,
      suspect: vehiclePositions.suspect,
    })
    .from(vehiclePositions)
    .where(and(...conditions))
    .orderBy(vehiclePositions.recordedAt, vehiclePositions.id)
    .limit(limit + 1);
  const truncated = rows.length > limit;
  return {
    missionId: mission.id,
    status: mission.status,
    pickup: { lat: mission.pickupLat, lng: mission.pickupLng, hubCode: mission.pickupHubCode, address: mission.pickupAddress },
    delivery: { lat: mission.deliveryLat, lng: mission.deliveryLng, hubCode: mission.deliveryHubCode, address: mission.deliveryAddress },
    points: rows.slice(0, limit).map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() })),
    truncated,
  };
}
