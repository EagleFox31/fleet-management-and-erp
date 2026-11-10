import { STAFF_EXCEPT_DRIVER_ROLES } from "@shared/constants/roles";

/**
 * Coordonnées du client d'une mission (contact, e-mail, téléphone) : liste blanche de rôles
 * (`STAFF_EXCEPT_DRIVER_ROLES`). Le chauffeur, un client ou un rôle inconnu reçoit l'identifiant et le nom
 * seulement : aucun écran chauffeur ne lit le reste (moindre donnée, échec fermé).
 */
export function canReadMissionClientContact(role: string | null | undefined): boolean {
  return (STAFF_EXCEPT_DRIVER_ROLES as readonly string[]).includes(String(role ?? ""));
}

export function redactMissionClientContact<T extends { client?: unknown }>(reader: { role?: string | null } | null | undefined, mission: T): T {
  if (canReadMissionClientContact(reader?.role)) return mission;
  const client = mission.client as { id?: unknown; name?: unknown } | null | undefined;
  if (!client || typeof client !== "object") return mission;
  return { ...mission, client: { id: client.id ?? null, name: client.name ?? null } };
}
