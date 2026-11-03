/**
 * Statuts d'affectation qui rattachent encore un chauffeur à son véhicule.
 *
 * Le serveur s'en sert pour refuser une panne hors périmètre
 * (`server/services/incident-service.ts`), l'écran de déclaration pour ne
 * proposer que ces véhicules (`client/src/lib/incident-vehicles.ts`). Une liste
 * recopiée de chaque côté finirait par proposer un véhicule que l'API refuse.
 */
export const ACTIVE_ASSIGNMENT_STATUSES = ["pending", "accepted", "in_progress"] as const;

export type ActiveAssignmentStatus = (typeof ACTIVE_ASSIGNMENT_STATUSES)[number];

/**
 * Statuts d'une affectation qui n'a jamais eu lieu : elle ne donne aucun droit (saisie carburant)
 * et ne reçoit aucune part du chiffre d'affaires de la mission. Une affectation terminée
 * (`completed`) n'est plus active mais reste comptée.
 */
export const VOID_ASSIGNMENT_STATUSES = ["cancelled", "rejected"] as const;

export function isVoidAssignmentStatus(status: string | null | undefined): boolean {
  return (VOID_ASSIGNMENT_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export function isActiveAssignmentStatus(status: string | null | undefined): boolean {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(String(status ?? ""));
}
