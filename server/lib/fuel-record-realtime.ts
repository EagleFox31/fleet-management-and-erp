import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { moduleLogger } from "./logger";

const log = moduleLogger("fuel-record-realtime");

/**
 * Couche 2 d'un plein créé, modifié ou supprimé : les règles d'anomalie (`tank-overflow`,
 * `odometer-regression`, `consumption-gap`) sont calculées à la lecture, donc le moindre plein
 * change la liste des anomalies des autres profils.
 * Événement dédié `fuel_record_changed` (rôles carburant), distinct de `fuel_record_validated`
 * qui reste celui de la validation d'un bon.
 */
export function broadcastFuelRecordChanged(id: number, requestId?: string): void {
  emit("fuel_record_changed", id, requestId);
}

/**
 * Couche 2 d'une capacité de réservoir modifiée (FUEL3) : `id` est celui du véhicule, pas d'un
 * plein, d'où un événement distinct de `fuel_record_changed`.
 */
export function broadcastVehicleTankCapacityChanged(vehicleId: number, requestId?: string): void {
  emit("vehicle_tank_capacity_changed", vehicleId, requestId);
}

function emit(event: "fuel_record_changed" | "vehicle_tank_capacity_changed", id: number, requestId?: string): void {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  if (typeof broadcast !== "function") {
    log.warn({ requestId, event }, "diffusion temps réel indisponible");
    return;
  }
  broadcast(event, { id, scope: REALTIME_EVENTS[event].scope });
}
