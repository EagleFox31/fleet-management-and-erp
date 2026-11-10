import { GPS_VIEW_ROLES } from "@shared/constants/roles";
import { moduleLogger } from "./logger";

const log = moduleLogger("vehicle-position-realtime");

/** Au plus une diffusion par véhicule et par fenêtre : un camion en route envoie un paquet toutes les 2 minutes ou moins. */
export const POSITION_BROADCAST_MIN_INTERVAL_MS = 30_000;

const lastBroadcastAt = new Map<number, number>();

/** Pour les tests : oublie les diffusions passées. */
export function resetVehiclePositionBroadcasts(): void {
  lastBroadcastAt.clear();
}

/**
 * Couche 2 (AGENTS.md §2) : `vehicle_position_updated`, portée `GPS_VIEW_ROLES` (identique au contrat).
 * Anti-tempête : au plus une fois toutes les 30 s par véhicule. Retourne vrai si l'événement est parti.
 */
export function broadcastVehiclePositionUpdated(vehicleId: number, missionId: number | null, requestId?: string, now: Date = new Date()): boolean {
  const last = lastBroadcastAt.get(vehicleId);
  if (last !== undefined && now.getTime() - last < POSITION_BROADCAST_MIN_INTERVAL_MS) return false;
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  if (typeof broadcast !== "function") {
    log.warn({ requestId, vehicleId }, "diffusion temps réel indisponible");
    return false;
  }
  lastBroadcastAt.set(vehicleId, now.getTime());
  broadcast("vehicle_position_updated", {
    vehicleId,
    missionId,
    scope: { type: "roles", roles: [...GPS_VIEW_ROLES] },
  });
  return true;
}
