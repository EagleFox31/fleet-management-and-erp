import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";

/**
 * Couche 2 : les profils qui choisissent un centre rechargent la liste.
 * Partagé par le routeur des centres et par la création implicite d'un centre
 * (résolveur, appelé par `POST /requests` et `POST /quick-renew`).
 */
export function broadcastCenterChanged(id: number): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  broadcastUpdate("document_renewal_center_changed", {
    entity: "document_renewal_center",
    entityId: id,
    payload: { id },
    scope: REALTIME_EVENTS.document_renewal_center_changed.scope,
  });
}
