import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { transitionWorkOrderStatus } from "../../server/services/work-order-status-transition";
import { workOrders } from "../../shared/schema";
import type { WorkOrderStatus } from "../../shared/constants/work-order-transitions";

async function currentStatus(id: number) {
  const [row] = await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, id));
  if (!row) throw new Error(`OT ${id} introuvable`);
  return row.status;
}

/**
 * Amène un OT au statut voulu par les chemins de production, jamais par `storage.updateWorkOrder`
 * (qui refuse le statut) :
 * - transition permise : `transitionWorkOrderStatus` (règle, compare-and-set, effets) ;
 * - `pending -> completed` n'est pas permis : l'OT est d'abord démarré, comme à l'atelier ;
 * - `completed -> in_progress` : écriture du refus qualité (`quality-check.routes.ts`), seul
 *   chemin qui rouvre un OT terminé.
 */
export async function moveWorkOrderTo(id: number, to: WorkOrderStatus) {
  const from = await currentStatus(id);
  if (from === "completed" && to === "in_progress") {
    await db
      .update(workOrders)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(and(eq(workOrders.id, id), eq(workOrders.status, "completed")));
    return;
  }
  if (from === "pending" && to === "completed") {
    await transitionWorkOrderStatus({ workOrderId: id, from, to: "in_progress" });
    await transitionWorkOrderStatus({ workOrderId: id, from: "in_progress", to });
    return;
  }
  await transitionWorkOrderStatus({ workOrderId: id, from, to });
}
