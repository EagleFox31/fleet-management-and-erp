/** Statuts d'une mission que le chauffeur a encore à faire. */
export const DRIVER_TODO_STATUSES = ["assigned", "in_progress"] as const;

type DriverMissionLike = { status: string; pickupDate?: string | Date | null };

function pickupTime(mission: DriverMissionLike): number {
  if (!mission.pickupDate) return Number.POSITIVE_INFINITY;
  const time = new Date(mission.pickupDate).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * Missions à faire du chauffeur, dans l'ordre où il doit les mener : une mission `in_progress` passe
 * devant les missions `assigned`, puis l'enlèvement le plus proche d'abord (sans date : en dernier).
 * `/api/drivers/me` trie par enlèvement décroissant : l'ordre est donc refait ici, sans dépendre du serveur.
 * La première est la mission active, les suivantes sont listées sous elle.
 */
export function splitDriverMissions<T extends DriverMissionLike>(missions: readonly T[]): { active: T | undefined; upcoming: T[] } {
  const todo = missions
    .filter((m) => (DRIVER_TODO_STATUSES as readonly string[]).includes(m.status))
    .map((mission, index) => ({ mission, index }))
    .sort(
      (a, b) =>
        Number(b.mission.status === "in_progress") - Number(a.mission.status === "in_progress") ||
        pickupTime(a.mission) - pickupTime(b.mission) ||
        a.index - b.index,
    )
    .map(({ mission }) => mission);
  return { active: todo[0], upcoming: todo.slice(1) };
}
