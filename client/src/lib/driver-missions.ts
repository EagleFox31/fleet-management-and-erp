/** Statuts d'une mission que le chauffeur a encore à faire. */
export const DRIVER_TODO_STATUSES = ["assigned", "in_progress"] as const;

/**
 * Missions à faire du chauffeur : la mission en cours de suivi (la première non terminée, telle que
 * renvoyée par `/api/drivers/me`) et les suivantes, à afficher en liste sous elle.
 */
export function splitDriverMissions<T extends { status: string }>(missions: readonly T[]): { active: T | undefined; upcoming: T[] } {
  const todo = missions.filter((m) => (DRIVER_TODO_STATUSES as readonly string[]).includes(m.status));
  return { active: todo[0], upcoming: todo.slice(1) };
}
