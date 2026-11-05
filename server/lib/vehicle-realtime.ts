import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { moduleLogger } from "./logger";

const log = moduleLogger("vehicle-realtime");

/** Couche 2 du retrait d'un véhicule ou de sa remise dans la flotte (AGENTS.md §2). */
export function broadcastVehicleLifecycle(event: "vehicle_deleted" | "vehicle_restored", vehicleId: number, requestId?: string): void {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  if (typeof broadcast !== "function") {
    log.warn({ requestId, event }, "diffusion temps réel indisponible");
    return;
  }
  broadcast(event, { id: vehicleId, vehicleId, scope: REALTIME_EVENTS[event].scope });
}
