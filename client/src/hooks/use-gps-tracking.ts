import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isApiError, userMessageOf } from "@/lib/api-error";
import { clientLogger } from "@/lib/logger";
import {
  appendBounded,
  foreignBufferKeys,
  gpsBufferKey,
  gpsPurgeEpoch,
  GPS_FLUSH_INTERVAL_MS,
  isBatchSettled,
  isBufferExpired,
  nextBatch,
  parseBuffer,
  removeSent,
  shouldDropBatch,
  shouldRecord,
  shouldRefreshDisplay,
  toGpsPoint,
  userBufferKeys,
  type GpsPoint,
  type GpsTrackingState,
  type RawFix,
} from "@/lib/gps-tracking";
import {
  driverMissionPositionsPath,
  driverPositionsResponseSchema,
  missionTrackPath,
  missionTrackResponseSchema,
  type MissionTrackPoint,
  type MissionTrackResponse,
} from "@shared/contracts/gps";

function readBuffer(key: string): GpsPoint[] {
  try {
    return parseBuffer(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

/**
 * Écrit (ou retire, si vide) le tampon. `epoch` est le compteur de purge relevé au début de l'opération :
 * si une déconnexion a purgé le stockage entre-temps, rien n'est réécrit (cloison entre comptes).
 */
function writeBuffer(key: string, buffer: readonly GpsPoint[], epoch: number): void {
  if (epoch !== gpsPurgeEpoch()) return;
  try {
    if (buffer.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(buffer));
  } catch (error) {
    // Stockage plein ou refusé : le suivi continue en mémoire, la mission n'en dépend pas.
    clientLogger.warn("Tampon GPS non persisté", { error: String(error) });
  }
}

export interface SendResult {
  /** Points restant à envoyer (réseau, 5xx, 401, 408, 429) : à garder au tampon. */
  remaining: GpsPoint[];
  sentAny: boolean;
  /** Message lisible si le serveur a refusé un paquet (dont 409 : plafond de points par mission). */
  error: string | null;
}

/**
 * Envoie un tampon par paquets de 50 au plus, du plus ancien au plus récent. Aucune relance en boucle :
 * à la première erreur passagère on s'arrête et le prochain déclencheur (2 min, retour réseau) reprend.
 * Un refus définitif (4xx hors 401/408/429) retire le paquet. Travaille sur la copie reçue, jamais sur
 * un état partagé : un changement de mission pendant l'envoi ne mélange pas les tampons.
 */
export async function sendBuffered(missionId: number, buffer: readonly GpsPoint[]): Promise<SendResult> {
  let remaining = [...buffer];
  let sentAny = false;
  let error: string | null = null;
  const epoch = gpsPurgeEpoch();
  while (remaining.length > 0) {
    // Déconnexion pendant l'envoi : plus rien ne part sous le compte suivant (cloison #56).
    if (epoch !== gpsPurgeEpoch()) break;
    const batch = nextBatch(remaining);
    try {
      const response = await apiRequest("POST", driverMissionPositionsPath(missionId), { points: batch });
      const result = driverPositionsResponseSchema.safeParse(await response.json());
      if (!result.success || !isBatchSettled(result.data, batch.length)) break;
      remaining = removeSent(remaining, batch);
      sentAny = true;
      error = null;
    } catch (caught) {
      if (isApiError(caught) && caught.status >= 400 && caught.status < 500) {
        error = userMessageOf(caught, "Position non envoyée.");
        if (shouldDropBatch(caught.status)) {
          remaining = removeSent(remaining, batch);
          clientLogger.warn("Paquet GPS refusé par le serveur", { status: caught.status, count: batch.length });
          continue;
        }
      }
      break;
    }
  }
  return { remaining, sentAny, error };
}

/** Couche 1 : la trace affichée se resynchronise dès qu'un envoi a abouti. */
function refreshTrack(missionId: number): void {
  void queryClient.invalidateQueries({ queryKey: [missionTrackPath(missionId)] });
}

let replaying = false;

/**
 * Verrou par clé de tampon (mémoire) : l'envoi final d'une session et le rejeu des orphelins ne lisent pas
 * la même clé en parallèle (les mêmes points partiraient deux fois). Le second arrivé passe son tour ;
 * ce qui reste au tampon repart au prochain déclencheur.
 */
const lockedKeys = new Set<string>();

async function withKeyLock(key: string, task: () => Promise<void>): Promise<void> {
  if (lockedKeys.has(key)) return;
  lockedKeys.add(key);
  try {
    await task();
  } finally {
    lockedKeys.delete(key);
  }
}

/**
 * Rejoue les tampons restés au navigateur pour d'autres missions de `userId` (livrées, terminées ou
 * annulées entre-temps : le serveur les accepte encore). Une clé est retirée une fois ses points réglés,
 * ou si le tampon a plus de 7 jours (y compris ceux des autres comptes, retirés sans envoi). `exceptMissionId` est la mission suivie en direct, gérée par son hook.
 */
export async function replayOrphanBuffers(userId: number, exceptMissionId?: number): Promise<void> {
  if (replaying) return;
  replaying = true;
  try {
    const epoch = gpsPurgeEpoch();
    let entries: Array<{ key: string; missionId: number }>;
    try {
      entries = userBufferKeys(window.localStorage, userId);
    } catch {
      return;
    }
    // Session expirée sans déconnexion : les tampons d'un autre compte de ce navigateur ne sont jamais
    // envoyés, mais ils ne restent pas indéfiniment sur un téléphone partagé.
    try {
      for (const key of foreignBufferKeys(window.localStorage, userId)) {
        if (isBufferExpired(readBuffer(key), Date.now())) writeBuffer(key, [], epoch);
      }
    } catch {
      // Stockage inaccessible : rien à nettoyer.
    }
    for (const { key, missionId } of entries) {
      if (missionId === exceptMissionId) continue;
      if (epoch !== gpsPurgeEpoch()) return;
      await withKeyLock(key, async () => {
        const buffer = readBuffer(key);
        if (isBufferExpired(buffer, Date.now())) {
          writeBuffer(key, [], epoch);
          return;
        }
        const result = await sendBuffered(missionId, buffer);
        writeBuffer(key, result.remaining, epoch);
        if (result.sentAny) refreshTrack(missionId);
      });
    }
  } finally {
    replaying = false;
  }
}

/** Au montage, au retour du réseau et toutes les 2 min : rejoue les tampons des missions déjà closes. */
export function useGpsBufferReplay(opts: { userId: number | undefined; trackingMissionId: number | undefined }): void {
  const { userId, trackingMissionId } = opts;
  useEffect(() => {
    if (!userId) return;
    void replayOrphanBuffers(userId, trackingMissionId);
    const onOnline = () => void replayOrphanBuffers(userId, trackingMissionId);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(onOnline, GPS_FLUSH_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [userId, trackingMissionId]);
}

export interface CurrentFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: number;
}

export interface GpsTracking {
  state: GpsTrackingState;
  current: CurrentFix | null;
  /** Dernier envoi réussi, en ms. */
  lastSentAt: number | null;
  /** Points relevés et pas encore envoyés. */
  pending: GpsPoint[];
  sendError: string | null;
}

export interface TrackingSession {
  key: string;
  missionId: number;
  epoch: number;
  buffer: GpsPoint[];
  flushing: boolean;
  closed: boolean;
}

/**
 * Envoie le tampon d'une session. Ne fait rien si une purge (déconnexion) a eu lieu depuis le montage
 * de la session, ni si la clé est déjà en cours d'envoi ailleurs. `onResult` n'est appelé que tant que
 * la session est ouverte.
 */
export async function flushTrackingSession(session: TrackingSession, onResult?: (result: SendResult) => void): Promise<void> {
  if (session.flushing) return;
  if (session.epoch !== gpsPurgeEpoch()) return;
  session.flushing = true;
  try {
    await withKeyLock(session.key, async () => {
      const snapshot = session.buffer;
      const result = await sendBuffered(session.missionId, snapshot);
      // Les points relevés pendant l'envoi sont ajoutés au tampon, pas écrasés.
      const sentIds = new Set(snapshot.map((p) => p.clientPointId));
      const remainingIds = new Set(result.remaining.map((p) => p.clientPointId));
      session.buffer = session.buffer.filter((p) => !sentIds.has(p.clientPointId) || remainingIds.has(p.clientPointId));
      writeBuffer(session.key, session.buffer, session.epoch);
      if (!session.closed) onResult?.(result);
      if (result.sentAny) refreshTrack(session.missionId);
    });
  } finally {
    session.flushing = false;
  }
}

/**
 * Suivi du téléphone pendant la mission en route (`in_progress`). Un point toutes les 60 s ou 200 m,
 * envoi par paquets toutes les 2 min et au retour du réseau. Aucune écriture hors de `in_progress` :
 * quand le suivi s'arrête (livraison, annulation, drapeau coupé), les écouteurs sont retirés
 * et un dernier envoi du tampon est tenté. Chaque session (utilisateur, mission) possède sa clé et son
 * tampon : un envoi lancé pour une mission ne touche jamais ceux d'une autre.
 */
export function useGpsTracking(opts: { userId: number | undefined; missionId: number | undefined; active: boolean }): GpsTracking {
  const { userId, missionId, active } = opts;
  const [state, setState] = useState<GpsTrackingState>("idle");
  const [current, setCurrent] = useState<CurrentFix | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [pending, setPending] = useState<GpsPoint[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !userId || !missionId) {
      setState("idle");
      return;
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState("unavailable");
      return;
    }
    const key = gpsBufferKey(userId, missionId);
    const session: TrackingSession = {
      key,
      missionId,
      epoch: gpsPurgeEpoch(),
      buffer: readBuffer(key),
      flushing: false,
      closed: false,
    };
    let lastKept: RawFix | null = null;
    let lastShown: RawFix | null = null;
    setPending(session.buffer);
    // « Position partagée » seulement après une position reçue, jamais avant ni sur une erreur passagère.
    setState("waiting");

    const flush = (): Promise<void> =>
      flushTrackingSession(session, (result) => {
        setPending(session.buffer);
        if (result.sentAny) setLastSentAt(Date.now());
        if (result.error) setSendError(result.error);
        else if (result.sentAny) setSendError(null);
      });

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (session.epoch !== gpsPurgeEpoch()) return;
        const fix: RawFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: position.timestamp,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
        };
        setState("sharing");
        if (shouldRefreshDisplay(lastShown, fix)) {
          lastShown = fix;
          setCurrent({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracy ?? null, at: fix.timestamp });
        }
        if (!shouldRecord(lastKept, fix)) return;
        lastKept = fix;
        session.buffer = appendBounded(session.buffer, toGpsPoint(fix));
        writeBuffer(session.key, session.buffer, session.epoch);
        setPending(session.buffer);
      },
      (error) => {
        // 1 = permission refusée. 2 (position indisponible) et 3 (délai) sont passagers : pas de partage affiché.
        if (error.code === error.PERMISSION_DENIED) setState("denied");
        else setState("waiting");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );

    void flush();
    const timer = window.setInterval(() => void flush(), GPS_FLUSH_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      // Dernier envoi : points relevés avant la livraison ou l'annulation. Si l'envoi échoue, le tampon
      // reste au navigateur et `useGpsBufferReplay` le rejoue (autre mission, retour réseau).
      void flush().finally(() => {
        session.closed = true;
      });
    };
  }, [active, userId, missionId]);

  return { state, current, lastSentAt, pending, sendError };
}

export interface MissionTrackData {
  track: MissionTrackResponse | null;
  points: MissionTrackPoint[];
}

/**
 * Trace déjà reçue par le serveur : une première lecture complète, puis des lectures
 * `?since=` qui s'ajoutent. Les points arrivent triés par heure de relevé.
 */
export function useMissionTrack(missionId: number | undefined, enabled: boolean, refetchMs: number | false): MissionTrackData {
  const pointsRef = useRef<MissionTrackPoint[]>([]);
  const missionRef = useRef<number | undefined>(undefined);
  if (missionRef.current !== missionId) {
    missionRef.current = missionId;
    pointsRef.current = [];
  }
  const query = useQuery<{ track: MissionTrackResponse; points: MissionTrackPoint[] }>({
    queryKey: [missionTrackPath(missionId ?? 0), "driver-track"],
    enabled: enabled && !!missionId,
    refetchInterval: refetchMs,
    retry: false,
    queryFn: async () => {
      const last = pointsRef.current[pointsRef.current.length - 1];
      const url = last ? `${missionTrackPath(missionId!)}?since=${encodeURIComponent(last.recordedAt)}` : missionTrackPath(missionId!);
      const response = await apiRequest("GET", url);
      const track = missionTrackResponseSchema.parse(await response.json());
      const known = new Set(pointsRef.current.map((p) => `${p.recordedAt}|${p.lat}|${p.lng}`));
      const fresh = track.points.filter((p) => !known.has(`${p.recordedAt}|${p.lat}|${p.lng}`));
      pointsRef.current = [...pointsRef.current, ...fresh];
      return { track, points: pointsRef.current };
    },
  });
  return { track: query.data?.track ?? null, points: query.data?.points ?? [] };
}
