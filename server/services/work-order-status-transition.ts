import { and, eq } from "drizzle-orm";
import { workOrders, type InsertWorkOrder, type WorkOrder } from "@shared/schema";
import { checkWorkOrderTransition, type WorkOrderStatus } from "@shared/constants/work-order-transitions";
import { db, type DbTransaction } from "../db";
import { AppError } from "../lib/app-error";
import { storage } from "../storage";
import { applyWorkOrderStatusEffects } from "./work-order-status-effects";

export const WORK_ORDER_STATUS_CHANGED_ERROR =
  "Le statut de cet ordre de travail vient de changer. Rechargez-le avant de réessayer.";

export const WORK_ORDER_ASSIGNMENT_CHANGED_ERROR =
  "Cet ordre de travail vient d'être réassigné. Rechargez vos ordres de travail avant de réessayer.";

export type WorkOrderStatusTransition = {
  workOrderId: number;
  /** Statut lu par l'appelant : l'écriture n'a lieu que si la ligne l'a encore. */
  from: string;
  to: WorkOrderStatus;
  updatedBy?: number | null;
  /**
   * Ligne qui n'a plus le statut lu : `throw` (défaut) répond 409 ; `skip` ne fait rien et
   * renvoie `null`, pour une transition de suite (ex. reprise après sortie de pièce) qui ne
   * doit pas faire échouer l'action déjà enregistrée.
   */
  onStale?: "throw" | "skip";
  /**
   * Rôle de l'auteur, passé à `checkWorkOrderTransition` : un technicien ne peut ni annuler ni
   * remettre en attente. Absent pour une transition de suite décidée par le serveur.
   */
  role?: string;
  /**
   * Champs écrits dans la même instruction que le statut, donc sous le même compare-and-set :
   * rien n'est écrit si la ligne n'a plus le statut lu. Le statut n'en fait jamais partie, ni
   * dans le type ni à l'exécution. Le service n'élargit pas ce que l'appelant écrit : il pose
   * `updatedAt`, et `updatedBy` seulement s'il est passé à part.
   */
  fields?: Partial<Omit<InsertWorkOrder, "status">>;
  /**
   * Condition ajoutée au compare-and-set : l'OT doit être encore assigné à ce technicien.
   * Un OT réassigné entre la lecture et l'écriture est traité comme un statut périmé.
   */
  technicianId?: number;
  /**
   * Écriture liée à la transition, dans la même transaction : si elle lève, le statut et les
   * champs sont annulés avec elle. Les effets sur le parc restent après la validation.
   */
  onTransition?: (tx: DbTransaction) => Promise<void>;
};

/**
 * Seule écriture du statut d'un OT, modification générique comprise : `storage.updateWorkOrder`
 * refuse le statut.
 *
 * 1. La règle `checkWorkOrderTransition` est appliquée ici, avec le rôle de l'auteur : une
 *    transition interdite (OT terminé, annulé, saut non prévu, annulation par un technicien)
 *    répond lisiblement. Le contrôle propre à la route technicien (`canTechnicianTransition`)
 *    reste chez elle.
 * 2. Compare-and-set : `WHERE id AND status = from`. Une transition concurrente gagne, l'autre
 *    reçoit 409 (ou `null` en `skip`) au lieu d'écraser le statut.
 * 3. Les effets sur le parc (`applyWorkOrderStatusEffects`) suivent l'écriture, comme avant.
 *
 * Les trames temps réel et les invalidations restent chez l'appelant (AGENTS.md §2).
 */
export async function transitionWorkOrderStatus(transition: WorkOrderStatusTransition): Promise<WorkOrder | null> {
  const { workOrderId, from, to, updatedBy, onStale = "throw", fields, technicianId, onTransition, role } = transition;
  const check = checkWorkOrderTransition(from, to, role);
  if (!check.allowed) throw new AppError(check.status, check.message);

  // Le type exclut déjà `status` : on le retire aussi à l'exécution, pour un appelant non typé.
  const { status: _ignoredStatus, ...columns } = (fields ?? {}) as Partial<InsertWorkOrder>;

  const conditions = [eq(workOrders.id, workOrderId), eq(workOrders.status, from as WorkOrderStatus)];
  if (technicianId !== undefined) conditions.push(eq(workOrders.technicianId, technicianId));

  const written = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(workOrders)
      .set({
        ...columns,
        status: to,
        ...(updatedBy != null ? { updatedBy } : {}),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning({ id: workOrders.id, vehicleId: workOrders.vehicleId, status: workOrders.status });
    if (row && onTransition) await onTransition(tx);
    return row;
  });
  if (!written) {
    if (onStale === "skip") return null;
    if (technicianId !== undefined) {
      const [current] = await db
        .select({ status: workOrders.status, technicianId: workOrders.technicianId })
        .from(workOrders)
        .where(eq(workOrders.id, workOrderId));
      if (current && current.status === from && current.technicianId !== technicianId) {
        throw new AppError(409, WORK_ORDER_ASSIGNMENT_CHANGED_ERROR);
      }
    }
    throw new AppError(409, WORK_ORDER_STATUS_CHANGED_ERROR);
  }

  await applyWorkOrderStatusEffects(written, from);
  // Retour enrichi (technicianName, createdByName…), comme `storage.updateWorkOrder`.
  return (await storage.getWorkOrder(workOrderId)) ?? null;
}
