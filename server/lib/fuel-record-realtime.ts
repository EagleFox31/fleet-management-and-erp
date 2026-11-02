import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { moduleLogger } from "./logger";

const log = moduleLogger("fuel-record-realtime");

/**
 * Couche 2 d'un plein créé, modifié ou supprimé : les règles d'anomalie (`tank-overflow`,
 * `odometer-regression`, `consumption-gap`) sont calculées à la lecture, donc le moindre plein
 * change la liste des anomalies des autres profils.
 *
 * Réutilise `fuel_record_validated` faute d'événement dédié : le catalogue invalide
 * `/api/fuel-records`, `/api/fuel-card` (dont `/api/fuel-card/anomalies`) et `/api/fuel-vouchers`,
 * et seuls les rôles carburant le reçoivent. Le nom ne dit pas « modifié » : un événement
 * `fuel_record_changed` est à déclarer dans `shared/contracts/realtime-events.ts` (autre lot).
 */
export function broadcastFuelRecordChanged(id: number, requestId?: string): void {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  if (typeof broadcast !== "function") {
    log.warn({ requestId }, "diffusion temps réel indisponible");
    return;
  }
  broadcast("fuel_record_validated", { id, scope: REALTIME_EVENTS.fuel_record_validated.scope });
}
