import { useEffect, useState } from "react";
import { useContractQuery } from "@/lib/contract-query";
import { useFeature } from "@/hooks/use-feature";
import { canViewPositions, canViewTrack } from "@/lib/gps-display";
import {
  missionTrackPath,
  missionTrackResponseSchema,
  VEHICLE_POSITIONS_PATH,
  vehiclePositionsResponseSchema,
} from "@shared/contracts/gps";

/**
 * Dernière position de chaque véhicule. Le drapeau `gps` coupé ou un rôle hors `GPS_VIEW_ROLES`
 * n'émet aucun appel. Le rafraîchissement vient du temps réel (`vehicle_position_updated`).
 */
export function useVehiclePositions(role: string | undefined | null) {
  const enabled = useFeature("gps") && canViewPositions(role);
  return useContractQuery(VEHICLE_POSITIONS_PATH, vehiclePositionsResponseSchema, undefined, {
    enabled,
    staleTime: 60_000,
  });
}

/** Trace d'une mission : `GPS_TRACK_ROLES` seulement (le chef d'atelier n'y a pas droit, pas d'appel). */
export function useMissionTrack(missionId: number | null | undefined, role: string | undefined | null) {
  const enabled = useFeature("gps") && canViewTrack(role) && typeof missionId === "number";
  return useContractQuery(missionTrackPath(missionId ?? 0), missionTrackResponseSchema, undefined, {
    enabled,
    staleTime: 60_000,
  });
}

/** Horloge qui fait avancer les libellés « il y a N min » sans nouvel appel réseau. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
