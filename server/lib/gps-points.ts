/**
 * Règles pures des positions GPS téléphone (GPS V1, lot API). Sans accès base : les unitaires
 * tournent sans DATABASE_URL. Les invariants durs (bornes, mesures, point sans mission, rejeu)
 * vivent en base (docs/analysis/GPS_V1_POSITIONS_BASE.md) ; ici, ce qui dépend de l'heure et de
 * la mission (fenêtre, rétention, futur) et la lecture du format OsmAnd / Traccar Client.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { LOGISTICS_HUBS } from "@shared/constants/cemac-corridors";
import { AppError } from "./app-error";
import { gpsPositionRetentionDays } from "./gps-retention";

/** Points par paquet (plan §6). */
export const GPS_BATCH_MAX = 50;
/** Un point relevé plus de 5 minutes dans le futur est refusé (horloge de l'appareil déréglée). */
export const GPS_FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Marge autour de la fenêtre de route : un relevé juste avant le départ ou après l'arrivée reste accepté. */
export const GPS_WINDOW_MARGIN_MS = 2 * 60_000;
/** Vitesse implicite au-delà de laquelle un point est marqué `suspect` (gardé, jamais rejeté). */
export const GPS_MAX_IMPLIED_SPEED_KMH = 200;

export const gpsPointSchema = z.object({
  clientPointId: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).nullish(),
  speedKmh: z.number().min(0).max(1_000).nullish(),
  heading: z.number().min(0).lt(360).nullish(),
});
export type GpsPointInput = z.infer<typeof gpsPointSchema>;

export const gpsBatchSchema = z.object({
  points: z.array(gpsPointSchema).min(1).max(GPS_BATCH_MAX),
});

export type GpsPoint = {
  clientPointId: string;
  recordedAt: Date;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
};

/**
 * Cap ramené dans [0, 360[ à un dixième de degré. La colonne est un `real` (float4) : 359.999999
 * y devient 360 et la contrainte `< 360` refuserait le paquet entier. L'arrondi se fait donc avant
 * l'envoi, et 360 (ou son arrondi) retombe sur 0.
 */
export function normalizeHeading(value: number): number {
  const rounded = Math.round((((value % 360) + 360) % 360) * 10) / 10;
  return rounded >= 360 ? 0 : rounded;
}

export function toGpsPoint(input: GpsPointInput): GpsPoint {
  return {
    clientPointId: input.clientPointId,
    recordedAt: new Date(input.recordedAt),
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM ?? null,
    speedKmh: input.speedKmh ?? null,
    heading: input.heading != null ? normalizeHeading(input.heading) : null,
  };
}

export type GpsRejectReason = "future" | "too_old" | "out_of_window";
export type GpsRejection = { clientPointId: string; reason: GpsRejectReason };

export type GpsWindow = {
  /** Départ confirmé (affectation.startedAt). */
  startedAt: Date;
  /** Arrivée (affectation.completedAt) ; null tant que la mission est en route. */
  endedAt: Date | null;
};

/**
 * Tri des points d'un paquet : futur, antérieurs à la rétention (sinon un rejeu après purge les
 * réinsérerait), hors de la fenêtre de route. Un point refusé est compté, jamais une erreur 500.
 */
export function classifyPoints(
  points: readonly GpsPoint[],
  ctx: { now: Date; window: GpsWindow; retentionDays?: number },
): { accepted: GpsPoint[]; rejected: GpsRejection[] } {
  const retentionMs = (ctx.retentionDays ?? gpsPositionRetentionDays()) * 86_400_000;
  const latest = ctx.now.getTime() + GPS_FUTURE_TOLERANCE_MS;
  const oldest = ctx.now.getTime() - retentionMs;
  const from = ctx.window.startedAt.getTime() - GPS_WINDOW_MARGIN_MS;
  const to = ctx.window.endedAt ? ctx.window.endedAt.getTime() + GPS_WINDOW_MARGIN_MS : Number.POSITIVE_INFINITY;
  const accepted: GpsPoint[] = [];
  const rejected: GpsRejection[] = [];
  for (const p of points) {
    const t = p.recordedAt.getTime();
    if (t > latest) rejected.push({ clientPointId: p.clientPointId, reason: "future" });
    else if (t < oldest) rejected.push({ clientPointId: p.clientPointId, reason: "too_old" });
    else if (t < from || t > to) rejected.push({ clientPointId: p.clientPointId, reason: "out_of_window" });
    else accepted.push(p);
  }
  return { accepted, rejected };
}

/** Distance orthodromique en kilomètres. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Marque les sauts aberrants : vitesse implicite depuis le point précédent (le dernier connu de la
 * mission, puis les points du paquet dans l'ordre du relevé) supérieure à 200 km/h. Renvoie
 * l'ensemble des `clientPointId` suspects. Deux points au même instant : écart de position ignoré
 * en dessous de 100 m (bruit), sinon suspect.
 */
export function suspectPointIds(
  previous: { lat: number; lng: number; recordedAt: Date } | null,
  points: readonly GpsPoint[],
): Set<string> {
  const suspects = new Set<string>();
  let last = previous;
  for (const p of [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    if (last) {
      const km = haversineKm(last, p);
      const hours = (p.recordedAt.getTime() - last.recordedAt.getTime()) / 3_600_000;
      if (hours <= 0 ? km > 0.1 : km / hours > GPS_MAX_IMPLIED_SPEED_KMH) suspects.add(p.clientPointId);
    }
    last = p;
  }
  return suspects;
}

/** Message utilisateur d'une contrainte CHECK de `vehicle_positions` (table de GPS_V1_POSITIONS_BASE.md). */
export const GPS_CHECK_MESSAGES: Readonly<Record<string, string>> = {
  vehicle_positions_coords_check: "Position GPS invalide.",
  vehicle_positions_measures_check: "Mesure GPS invalide (précision, vitesse ou cap).",
  vehicle_positions_phone_check: "Position téléphone hors mission.",
  missions_pickup_geo_check: "Point de départ incomplet ou hors limites.",
  missions_delivery_geo_check: "Point d'arrivée incomplet ou hors limites.",
};

/** 23514 sur une contrainte connue : 400 lisible. Contrainte inconnue (interne) : null, l'appelant relance l'erreur. */
export function gpsCheckAppError(constraint: string | undefined, cause: unknown): AppError | null {
  const message = constraint ? GPS_CHECK_MESSAGES[constraint] : undefined;
  return message ? new AppError(400, message, { cause }) : null;
}

// ---------- Format OsmAnd / Traccar Client ----------

/**
 * Identifiant de point déterministe (sha256 tronqué à 128 bits, bits de version et de variante posés) : un
 * même relevé renvoyé par Traccar Client après une coupure retombe sur la même clé, donc sur le
 * `ON CONFLICT` de `vehicle_positions_client_point_unique`.
 */
export function derivedPointId(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const KNOTS_TO_KMH = 1.852;
const MPS_TO_KMH = 3.6;

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Même lecture que le décodeur OsmAnd de Traccar : secondes, millisecondes ou date ISO. */
export function parseOsmandTimestamp(value: unknown, now: Date): Date | null {
  if (value === undefined || value === null || value === "") return now;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    const fromNumber = new Date(n < 2_147_483_647 ? n * 1000 : n);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

const flat = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/**
 * Un relevé OsmAnd en JSON (`{ id, lat, lon, timestamp, speed, bearing, accuracy }`, vitesse en
 * nœuds) ou JSON de Traccar Client (`{ location: { timestamp, coords: { latitude, longitude, speed, heading,
 * accuracy } } }`). Vitesse : nœuds à plat, m/s sous `location.coords` (Traccar, OsmAndProtocolDecoder), `-1` =
 * inconnue. L'identifiant `id` n'identifie personne : l'identité vient de la session. Renvoie null si
 * latitude, longitude ou horodatage manquent ou sont illisibles.
 */
export function parseOsmandReport(
  body: unknown,
  ctx: { now: Date; userId: number; missionId: number },
): GpsPoint | null {
  let lat: number | undefined;
  let lng: number | undefined;
  let speedKmh: number | undefined;
  let heading: number | undefined;
  let accuracy: number | undefined;
  let recordedAt: Date | null;

  const json = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const location = json && typeof json.location === "object" && json.location ? (json.location as Record<string, unknown>) : null;
  if (location) {
    const coords = (location.coords && typeof location.coords === "object" ? location.coords : {}) as Record<string, unknown>;
    lat = num(coords.latitude);
    lng = num(coords.longitude);
    const speed = num(coords.speed);
    speedKmh = speed !== undefined && speed >= 0 ? speed * MPS_TO_KMH : undefined;
    const course = num(coords.heading);
    heading = course !== undefined && course >= 0 ? course : undefined;
    accuracy = num(coords.accuracy);
    recordedAt = parseOsmandTimestamp(location.timestamp, ctx.now);
  } else {
    const merged: Record<string, unknown> = json ?? {};
    lat = num(flat(merged.lat));
    lng = num(flat(merged.lon));
    const pair = typeof flat(merged.location) === "string" ? String(flat(merged.location)).split(",") : null;
    if ((lat === undefined || lng === undefined) && pair && pair.length === 2) {
      lat = num(pair[0]);
      lng = num(pair[1]);
    }
    const speed = num(flat(merged.speed));
    speedKmh = speed !== undefined && speed >= 0 ? speed * KNOTS_TO_KMH : undefined;
    const course = num(flat(merged.bearing) ?? flat(merged.heading));
    heading = course !== undefined && course >= 0 ? course : undefined;
    accuracy = num(flat(merged.accuracy));
    recordedAt = parseOsmandTimestamp(flat(merged.timestamp), ctx.now);
  }
  if (lat === undefined || lng === undefined || !recordedAt || Number.isNaN(recordedAt.getTime())) return null;
  // Le point décodé passe par le schéma du paquet JSON : mêmes bornes, jamais de valeur qui ferait
  // échouer l'INSERT (22003/22008) ou lever sur la date. Précision et vitesse hors bornes sont
  // ramenées à la borne (un relevé bruité reste un relevé) ; latitude, longitude ou date hors limites
  // rendent le relevé illisible.
  const clientPointId = derivedPointId(`osmand|${ctx.userId}|${ctx.missionId}|${recordedAt.getTime()}|${lat}|${lng}`);
  let recordedIso: string;
  try {
    recordedIso = recordedAt.toISOString();
  } catch {
    return null;
  }
  const parsed = gpsPointSchema.safeParse({
    clientPointId,
    recordedAt: recordedIso,
    lat,
    lng,
    accuracyM: accuracy !== undefined && accuracy >= 0 ? Math.min(accuracy, 100_000) : null,
    speedKmh: speedKmh !== undefined ? Math.min(speedKmh, 1_000) : null,
    heading: heading !== undefined ? normalizeHeading(heading) : null,
  });
  return parsed.success ? toGpsPoint(parsed.data) : null;
}

// ---------- Points A / B des missions ----------

export const MISSION_GEO_HUB_CODES: readonly string[] = Object.keys(LOGISTICS_HUBS);

export type MissionGeoPoint = { lat: number | null; lng: number | null; hubCode: string | null };

const GEO_LABELS = { pickup: "de départ", delivery: "d'arrivée" } as const;

/**
 * Point A ou B d'une mission. Un code de hub doit exister dans le référentiel CEMAC
 * (`shared/constants/cemac-corridors.ts`) : les coordonnées sont alors celles du hub, quelles que
 * soient celles envoyées. Sans code : latitude et longitude ensemble (point posé sur la carte) ou
 * ni l'une ni l'autre. Les bornes sont aussi tenues en base (`missions_*_geo_check`).
 */
export function resolveMissionGeoPoint(
  which: keyof typeof GEO_LABELS,
  input: { lat?: unknown; lng?: unknown; hubCode?: unknown },
): MissionGeoPoint {
  const label = GEO_LABELS[which];
  const hubCode = typeof input.hubCode === "string" && input.hubCode.trim() !== "" ? input.hubCode.trim() : null;
  if (hubCode !== null) {
    const hub = Object.hasOwn(LOGISTICS_HUBS, hubCode) ? LOGISTICS_HUBS[hubCode] : undefined;
    if (!hub) throw new AppError(400, `Hub ${label} inconnu : choisissez un hub de la liste.`);
    return { lat: hub.coordinates[0], lng: hub.coordinates[1], hubCode };
  }
  const lat = num(input.lat);
  const lng = num(input.lng);
  if (lat === undefined && lng === undefined) return { lat: null, lng: null, hubCode: null };
  if (lat === undefined || lng === undefined || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError(400, `Point ${label} incomplet ou hors limites.`);
  }
  return { lat, lng, hubCode: null };
}

export type MissionGeoColumns = Partial<{
  pickupLat: number | null; pickupLng: number | null; pickupHubCode: string | null;
  deliveryLat: number | null; deliveryLng: number | null; deliveryHubCode: string | null;
}>;

const hasAny = (o: Record<string, unknown>, keys: string[]) => keys.some((k) => o[k] !== undefined);

/**
 * Colonnes A/B d'une mission à écrire d'après un corps de requête (`pickupLat`, `pickupLng`,
 * `pickupHubCode`, idem `delivery*`). Un point absent du corps n'est pas touché ; un point présent
 * (même tout à null, qui l'efface) est validé par `resolveMissionGeoPoint`.
 */
export function missionGeoColumnsFromBody(body: unknown): MissionGeoColumns {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: MissionGeoColumns = {};
  if (hasAny(b, ["pickupLat", "pickupLng", "pickupHubCode"])) {
    const p = resolveMissionGeoPoint("pickup", { lat: b.pickupLat, lng: b.pickupLng, hubCode: b.pickupHubCode });
    out.pickupLat = p.lat; out.pickupLng = p.lng; out.pickupHubCode = p.hubCode;
  }
  if (hasAny(b, ["deliveryLat", "deliveryLng", "deliveryHubCode"])) {
    const p = resolveMissionGeoPoint("delivery", { lat: b.deliveryLat, lng: b.deliveryLng, hubCode: b.deliveryHubCode });
    out.deliveryLat = p.lat; out.deliveryLng = p.lng; out.deliveryHubCode = p.hubCode;
  }
  return out;
}
