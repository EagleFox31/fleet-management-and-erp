/**
 * Diffusion temps reel des evenements chauffeur (scope `broadcast` : tous les sockets).
 * La charge ne porte jamais la fiche : CNI, n de permis et date de naissance sont reserves
 * aux gestionnaires (redactDriverPersonalData). Les ecrans refont un GET filtre par role.
 */
export type DriverRealtimeEvent =
  | "driver_created"
  | "driver_updated"
  | "driver_toggled"
  | "driver_cpc_updated"
  | "driver_cpc_statuses_synced";

export function broadcastDriverEvent(
  eventType: DriverRealtimeEvent,
  driverId: number | null,
  extraPayload: Record<string, unknown> = {},
  actor?: { userId?: number | null; role?: string | null },
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;

  broadcastUpdate(eventType, {
    version: 1,
    entity: "driver",
    entityId: driverId,
    payload: { ...(driverId !== null ? { driverId } : {}), ...extraPayload },
    scope: { type: "broadcast" },
    ...(actor ? { actor: { userId: actor.userId ?? null, role: actor.role ?? null } } : {}),
    emittedAt: new Date().toISOString(),
  });
}
