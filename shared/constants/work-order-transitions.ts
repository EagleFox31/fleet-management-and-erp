import { canTechnicianTransition } from "./technician-work-order-transitions";

/**
 * Transitions de statut d'un OT par la modification générique
 * (`PATCH /api/work-orders/:id` : fiche, tableau, modale d'édition).
 *
 * - Garder le même statut est toujours permis (la modale renvoie le statut courant).
 * - Un OT terminé ne revient en cours que par le contrôle qualité
 *   (`POST /api/work-orders/:id/quality-check`), avec motif.
 * - Un OT annulé ne se rouvre pas.
 * - Le technicien n'a que ses gestes (`canTechnicianTransition`) ; annuler ou
 *   remettre en attente revient au chef d'atelier.
 */
export const WORK_ORDER_STATUSES = ["pending", "in_progress", "awaiting_parts", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const MANAGER_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  pending: ["in_progress", "awaiting_parts", "cancelled"],
  in_progress: ["pending", "awaiting_parts", "completed", "cancelled"],
  awaiting_parts: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export type WorkOrderTransitionCheck =
  | { allowed: true }
  | { allowed: false; status: 403 | 409; message: string };

export function checkWorkOrderTransition(from: string, to: string, role: string | undefined): WorkOrderTransitionCheck {
  if (from === to) return { allowed: true };
  if (from === "completed") {
    return {
      allowed: false,
      status: 409,
      message: "Cet ordre de travail est terminé. Pour le reprendre, passez par le contrôle qualité.",
    };
  }
  if (from === "cancelled") {
    return { allowed: false, status: 409, message: "Cet ordre de travail est annulé : il ne peut pas être rouvert." };
  }
  if (!(MANAGER_TRANSITIONS[from as WorkOrderStatus] ?? []).includes(to as WorkOrderStatus)) {
    return { allowed: false, status: 409, message: "Ce changement de statut n'est pas possible pour cet ordre de travail." };
  }
  if (role === "technician" && !canTechnicianTransition(from, to)) {
    return {
      allowed: false,
      status: 403,
      message: "Seul le chef d'atelier peut annuler un ordre de travail ou le remettre en attente.",
    };
  }
  return { allowed: true };
}
