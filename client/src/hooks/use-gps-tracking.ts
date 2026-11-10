import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isApiError, userMessageOf } from "@/lib/api-error";
import { clientLogger } from "@/lib/logger";
import {
  appendBounded,
  gpsBufferKey,
  GPS_FLUSH_INTERVAL_MS,
  isBatchSettled,
  nextBatch,
  parseBuffer,
  removeSent,
  shouldRecord,
  toGpsPoint,
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
} from "@shared/contracts/gps-track";

function readBuffer(key: string): GpsPoint[] {
  try {
    return parseBuffer(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeBuffer(key: string, buffer: readonly GpsPoint[]): void {
  try {
    if (buffer.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(buffer));
  } catch (error) {
    // Stockage plein ou refusé : le suivi continue en mémoire, la mission n'en dépend pas.
    clientLogger.warn("Tampon GPS non persisté", { error: String(error) });
  }
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

/**
 * Suivi du téléphone pendant la mission en route (`active`). Un point toutes les 60 s ou 200 m,
 * envoi par paquets toutes les 2 min et au retour du réseau. Aucune écriture hors de `active` :
 * quand le suivi s'arrête (livraison, annulation, drapeau coupé), les écouteurs sont retirés
 * et un dernier envoi du tampon est tenté.
 */
export function useGpsTracking(opts: { userId: number | undefined; missionId: number | undefined; active: boolean }): GpsTracking {
  const { userId, missionId, active } = opts;
  const [state, setState] = useState<GpsTrackingState>("idle");
  const [current, setCurrent] = useState<CurrentFix | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [pending, setPending] = useState<GpsPoint[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const bufferRef = useRef<GpsPoint[]>([]);
  const lastKeptRef = useRef<RawFix | null>(null);
  const flushingRef = useRef(false);

  const flush = useCallback(async (): Promise<void> => {
    if (!userId || !missionId || flushingRef.current) return;
    const key = gpsBufferKey(userId, missionId);
    flushingRef.current = true;
    try {
      // Boucle : un tampon de plus de 50 points part en plusieurs paquets.
      while (bufferRef.current.length > 0) {
        const batch = nextBatch(bufferRef.current);
        try {
          const response = await apiRequest("POST", driverMissionPositionsPath(missionId), { points: batch });
          const result = driverPositionsResponseSchema.safeParse(await response.json());
          if (!result.success || !isBatchSettled(result.data, batch.length)) break;
          bufferRef.current = removeSent(bufferRef.current, batch);
          setLastSentAt(Date.now());
          setSendError(null);
        } catch (error) {
          // Un refus (dont 429 : plafond de points par mission) s'affiche tel quel ; aucune relance en boucle,
          // le relevé suivant déclenchera le prochain envoi.
          if (isApiError(error) && error.status >= 400 && error.status < 500) setSendError(userMessageOf(error, "Position non envoyée."));
          // 4xx : le serveur refuse ce paquet (mission close, affectation levée, drapeau coupé) ;
          // le renvoyer ne changerait rien, on le retire. Réseau ou 5xx : on garde pour le rejeu.
          if (isApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
            bufferRef.current = removeSent(bufferRef.current, batch);
            clientLogger.warn("Paquet GPS refusé par le serveur", { status: error.status, count: batch.length });
            continue;
          }
          break;
        }
      }
    } finally {
      writeBuffer(key, bufferRef.current);
      setPending(bufferRef.current);
      flushingRef.current = false;
    }
  }, [userId, missionId]);

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
    bufferRef.current = readBuffer(key);
    lastKeptRef.current = null;
    setPending(bufferRef.current);
    setState("sharing");

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const fix: RawFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: position.timestamp,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
        };
        setState("sharing");
        setCurrent({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracy ?? null, at: fix.timestamp });
        if (!shouldRecord(lastKeptRef.current, fix)) return;
        lastKeptRef.current = fix;
        bufferRef.current = appendBounded(bufferRef.current, toGpsPoint(fix));
        writeBuffer(key, bufferRef.current);
        setPending(bufferRef.current);
      },
      (error) => {
        // 1 = permission refusée. 2 (position indisponible) et 3 (délai) sont passagers.
        if (error.code === error.PERMISSION_DENIED) setState("denied");
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
      // Dernier envoi : points relevés avant la livraison ou l'annulation.
      void flush();
    };
  }, [active, userId, missionId, flush]);

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
