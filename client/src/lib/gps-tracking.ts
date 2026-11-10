/**
 * Suivi GPS du téléphone du chauffeur (V1) : logique pure, sans navigateur ni réseau.
 * L'API est `POST /api/driver/missions/:id/positions` (<= 50 points, idempotente par clientPointId).
 *
 * Le tampon des points non envoyés est PROPRE au GPS : il ne partage ni clé ni base avec la file
 * hors ligne V5b (IndexedDB `fleetos-offline-u<id>`). Il vit dans le localStorage, une clé par
 * utilisateur et par mission, et une position qui ne part pas ne bloque jamais une écriture métier.
 */

/** Cadence (valeurs du cadrage, provisoires) : le premier seuil atteint déclenche un relevé. */
export const GPS_SAMPLE_INTERVAL_MS = 60_000;
export const GPS_SAMPLE_DISTANCE_M = 200;
export const GPS_FLUSH_INTERVAL_MS = 120_000;
export const GPS_BATCH_MAX = 50;
/** Garde-fou du tampon : au-delà, les points les plus anciens sont jetés (environ 17 h à 1 point/min). */
export const GPS_BUFFER_MAX = 1000;

export interface GpsPoint {
  clientPointId: string;
  recordedAt: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  speedKmh?: number;
  heading?: number;
}

export interface RawFix {
  lat: number;
  lng: number;
  /** Horodatage du relevé, en millisecondes (GeolocationPosition.timestamp). */
  timestamp: number;
  accuracy?: number | null;
  /** m/s, comme GeolocationCoordinates.speed. */
  speed?: number | null;
  heading?: number | null;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Relevé à garder ? Premier point, ou 60 s écoulées, ou 200 m parcourus depuis le dernier gardé. */
export function shouldRecord(last: RawFix | null, next: RawFix): boolean {
  if (!last) return true;
  if (next.timestamp - last.timestamp >= GPS_SAMPLE_INTERVAL_MS) return true;
  return distanceMeters(last, next) >= GPS_SAMPLE_DISTANCE_M;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Point prêt à l'envoi. L'identifiant est généré ici, une seule fois : renvoyer le même point
 * (rejeu après coupure) garde le même `clientPointId`, le serveur le compte en doublon.
 */
export function toGpsPoint(fix: RawFix, makeId: () => string = newUuid): GpsPoint {
  const point: GpsPoint = {
    clientPointId: makeId(),
    recordedAt: new Date(fix.timestamp).toISOString(),
    lat: fix.lat,
    lng: fix.lng,
  };
  if (typeof fix.accuracy === "number" && Number.isFinite(fix.accuracy) && fix.accuracy >= 0) point.accuracyM = fix.accuracy;
  if (typeof fix.speed === "number" && Number.isFinite(fix.speed) && fix.speed >= 0) {
    point.speedKmh = Math.round(fix.speed * 3.6 * 10) / 10;
  }
  if (typeof fix.heading === "number" && Number.isFinite(fix.heading) && fix.heading >= 0 && fix.heading < 360) {
    point.heading = fix.heading;
  }
  return point;
}

/** Paquet à envoyer : les plus anciens d'abord, 50 au plus. */
export function nextBatch(buffer: readonly GpsPoint[]): GpsPoint[] {
  return buffer.slice(0, GPS_BATCH_MAX);
}

/** Retire du tampon les points dont l'envoi est acquis. */
export function removeSent(buffer: readonly GpsPoint[], sent: readonly GpsPoint[]): GpsPoint[] {
  const ids = new Set(sent.map((p) => p.clientPointId));
  return buffer.filter((p) => !ids.has(p.clientPointId));
}

/** Ajoute un point en bornant le tampon (les plus anciens partent d'abord). */
export function appendBounded(buffer: readonly GpsPoint[], point: GpsPoint): GpsPoint[] {
  const next = [...buffer, point];
  return next.length > GPS_BUFFER_MAX ? next.slice(next.length - GPS_BUFFER_MAX) : next;
}

export interface GpsIngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
}

/**
 * Le paquet est réglé côté serveur si chaque point envoyé a reçu une décision : accepté, doublon
 * (déjà reçu lors d'un rejeu) ou refusé définitivement (point invalide, trop ancien). Tous sont
 * retirés du tampon. `accepted: 0` avec des doublons est donc un succès.
 */
export function isBatchSettled(result: unknown, sentCount: number): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Partial<GpsIngestResult>;
  const total = (r.accepted ?? 0) + (r.duplicates ?? 0) + (r.rejected ?? 0);
  return Number.isFinite(total) && total >= sentCount;
}

export function gpsBufferKey(userId: number, missionId: number): string {
  return `fleetos-gps-buffer-u${userId}-m${missionId}`;
}

export function parseBuffer(raw: string | null): GpsPoint[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is GpsPoint =>
        !!p &&
        typeof p === "object" &&
        typeof (p as GpsPoint).clientPointId === "string" &&
        typeof (p as GpsPoint).recordedAt === "string" &&
        Number.isFinite((p as GpsPoint).lat) &&
        Number.isFinite((p as GpsPoint).lng),
    );
  } catch {
    return [];
  }
}

/** Lien Google Maps URLs (sans clé ni coût). Point = coordonnées si connues, sinon adresse texte. */
export type RoutePoint = { lat?: number | null; lng?: number | null; address?: string | null };

function pointParam(point: RoutePoint): string | null {
  if (typeof point.lat === "number" && typeof point.lng === "number") return `${point.lat},${point.lng}`;
  const address = point.address?.trim();
  return address ? address : null;
}

export function buildGoogleDirectionsUrl(origin: RoutePoint | null, destination: RoutePoint): string | null {
  const dest = pointParam(destination);
  if (!dest) return null;
  const params = new URLSearchParams({ api: "1" });
  const from = origin ? pointParam(origin) : null;
  if (from) params.set("origin", from);
  params.set("destination", dest);
  params.set("travelmode", "driving");
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export type GpsTrackingState = "idle" | "sharing" | "denied" | "unavailable";

/** Le suivi tourne seulement pendant la route : de `in_progress` jusqu'à `delivered`. */
export function shouldTrack(status: string | undefined, gpsEnabled: boolean): boolean {
  return gpsEnabled && status === "in_progress";
}
