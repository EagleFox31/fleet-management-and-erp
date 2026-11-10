/**
 * Coordonnées du client d'une mission (contact, e-mail, téléphone) : le chauffeur n'en a pas l'usage, aucun écran
 * chauffeur ne les lit. Il reçoit le nom du client seulement (moindre donnée). Le personnel garde la ligne entière.
 */
export function redactMissionClientContact<T extends { client?: unknown }>(reader: { role?: string | null } | null | undefined, mission: T): T {
  if (reader?.role !== "driver") return mission;
  const client = mission.client as { id?: unknown; name?: unknown } | null | undefined;
  if (!client || typeof client !== "object") return mission;
  return { ...mission, client: { id: client.id ?? null, name: client.name ?? null } };
}
