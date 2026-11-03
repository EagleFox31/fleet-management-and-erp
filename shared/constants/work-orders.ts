import { workOrders } from "@shared/schema";

/**
 * Libellés français du statut et de la priorité des ordres de travail :
 * source unique de l'export serveur. Reprend les libellés affichés par l'UI
 * (`translateStatus` / `translatePriority`, client/src/lib/utils.ts).
 *
 * `Record<enum, string>` dérivé du schéma : une valeur d'enum ajoutée sans
 * libellé casse `tsc`.
 */
export type WorkOrderStatus = NonNullable<typeof workOrders.$inferSelect>["status"];
export type WorkOrderPriority = NonNullable<typeof workOrders.$inferSelect>["priority"];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending: "En attente",
  in_progress: "En cours",
  awaiting_parts: "Attente pièces",
  completed: "Terminé",
  cancelled: "Annulé",
};

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
};

/** Valeurs de l'enum du schéma, à l'exécution. */
export const WORK_ORDER_STATUSES = workOrders.status.enumValues as readonly WorkOrderStatus[];
export const WORK_ORDER_PRIORITIES = workOrders.priority.enumValues as readonly WorkOrderPriority[];
