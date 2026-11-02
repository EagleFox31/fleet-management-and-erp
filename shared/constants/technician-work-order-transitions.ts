/**
 * Transitions qu'un technicien peut faire sur son propre ordre de travail
 * (écran « Mes ordres de travail »).
 *
 * - `in_progress -> in_progress` : mise à jour du diagnostic en cours de réparation.
 * - `awaiting_parts -> in_progress` : reprise quand la pièce est sortie du stock.
 *   Le passage en `awaiting_parts` a sa propre route (demande de pièce).
 * - Un OT terminé ou annulé ne se modifie plus ici. Le retour d'un OT terminé
 *   passe par le contrôle qualité du chef d'atelier.
 */
export const TECHNICIAN_TARGET_STATUSES = ["in_progress", "completed"] as const;
export type TechnicianTargetStatus = (typeof TECHNICIAN_TARGET_STATUSES)[number];

const TECHNICIAN_TRANSITIONS: Readonly<Record<string, readonly TechnicianTargetStatus[]>> = {
  pending: ["in_progress"],
  in_progress: ["in_progress", "completed"],
  awaiting_parts: ["in_progress"],
  completed: [],
  cancelled: [],
};

export function canTechnicianTransition(from: string, to: string): boolean {
  return (TECHNICIAN_TRANSITIONS[from] ?? []).includes(to as TechnicianTargetStatus);
}
