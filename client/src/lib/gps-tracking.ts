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
/** Borne du schéma serveur (`server/lib/gps-points.ts`) : au-delà, le paquet entier serait refusé. */
export const GPS_ACCURACY_MAX_M = 100_000;
/** Un tampon dont le point le plus récent a plus de 7 jours n'est plus rejoué : il est supprimé. */
export const GPS_BUFFER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Position affichée à l'écran : rafraîchie au plus toutes les 10 s, ou dès 20 m parcourus. */
export const GPS_DISPLAY_INTERVAL_MS = 10_000;
export const GPS_DISPLAY_DISTANCE_M = 20;

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
  if (typeof fix.accuracy === "number" && Number.isFinite(fix.accuracy) && fix.accuracy >= 0) {
    point.accuracyM = Math.min(fix.accuracy, GPS_ACCURACY_MAX_M);
  }
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

/** Préfixe commun des tampons : la purge de déconnexion le cible explicitement (hors motif des brouillons). */
export const GPS_BUFFER_KEY_PREFIX = "fleetos-gps-buffer-";

export function gpsBufferKey(userId: number, missionId: number): string {
  return `${GPS_BUFFER_KEY_PREFIX}u${userId}-m${missionId}`;
}

/** Mission d'une clé de tampon appartenant à `userId`, sinon null (autre utilisateur ou autre clé). */
export function missionIdOfBufferKey(key: string, userId: number): number | null {
  const match = new RegExp(`^${GPS_BUFFER_KEY_PREFIX}u${userId}-m(\\d+)$`).exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

type KeyStorage = Pick<Storage, "length" | "key" | "removeItem">;

function bufferKeys(storage: KeyStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(GPS_BUFFER_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

/** Clés de tampon d'un utilisateur, toutes missions confondues. */
export function userBufferKeys(storage: KeyStorage, userId: number): Array<{ key: string; missionId: number }> {
  const found: Array<{ key: string; missionId: number }> = [];
  for (const key of bufferKeys(storage)) {
    const missionId = missionIdOfBufferKey(key, userId);
    if (missionId) found.push({ key, missionId });
  }
  return found;
}

/** Clés de tampon qui n'appartiennent pas à `userId` (autres comptes du même navigateur). */
export function foreignBufferKeys(storage: KeyStorage, userId: number): string[] {
  return bufferKeys(storage).filter((key) => missionIdOfBufferKey(key, userId) === null);
}

let purgeEpoch = 0;

/** Compteur incrémenté à chaque purge : une écriture lancée avant une purge doit s'abstenir. */
export function gpsPurgeEpoch(): number {
  return purgeEpoch;
}

/**
 * Changement de compte (S1) : l'époque avance, donc plus aucun envoi ni écriture lancés pour l'ancien
 * compte ne part sous la session du nouveau, et les tampons de tout autre compte que `userId` sont
 * détruits sans délai. Ne lève jamais.
 */
export function purgeGpsBuffersOfOthers(userId: number, storage?: KeyStorage | null): number {
  purgeEpoch += 1;
  try {
    const target = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!target) return 0;
    const keys = foreignBufferKeys(target, userId);
    for (const key of keys) target.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Déconnexion : supprime les tampons de tous les comptes de ce navigateur (cloison #56) et invalide
 * toute écriture en cours. Ne lève jamais.
 */
export function purgeGpsBuffers(storage?: KeyStorage | null): number {
  purgeEpoch += 1;
  try {
    const target = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!target) return 0;
    const keys = bufferKeys(target);
    for (const key of keys) target.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

/** Tampon périmé : vide, ou dont le point le plus récent a plus de 7 jours. */
export function isBufferExpired(buffer: readonly GpsPoint[], now: number): boolean {
  const times = buffer.map((p) => Date.parse(p.recordedAt)).filter(Number.isFinite);
  if (times.length === 0) return true;
  return now - Math.max(...times) > GPS_BUFFER_MAX_AGE_MS;
}

/**
 * Sort d'un paquet refusé. Le serveur répond 4xx quand il ne veut définitivement plus ces points
 * (mission close, affectation levée, drapeau coupé) : on les retire. 401 (session expirée), 408 et 429
 * sont passagers : le paquet reste au tampon, rejoué après reconnexion du même utilisateur.
 */
export function shouldDropBatch(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

/** Position affichée à rafraîchir ? Première, ou 10 s écoulées, ou 20 m parcourus. */
export function shouldRefreshDisplay(last: RawFix | null, next: RawFix): boolean {
  if (!last) return true;
  if (next.timestamp - last.timestamp >= GPS_DISPLAY_INTERVAL_MS) return true;
  return distanceMeters(last, next) >= GPS_DISPLAY_DISTANCE_M;
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

export type GpsTrackingState = "idle" | "waiting" | "sharing" | "denied" | "unavailable";

/** Le suivi tourne seulement pendant la route : de `in_progress` jusqu'à `delivered`. */
export function shouldTrack(status: string | undefined, gpsEnabled: boolean): boolean {
  return gpsEnabled && status === "in_progress";
}
