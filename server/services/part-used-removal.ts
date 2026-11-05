import { eq } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { storage } from "../storage";
import { partsUsed, workOrders } from "@shared/schema";

const log = moduleLogger("part-used-removal");

/** Un OT terminé ne perd plus de pièce : la correction passe par un ajustement de stock du magasin. */
const CLOSED_WORK_ORDER_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

export type PartUsedRemoval = { partUsedId: number; workOrderId: number; partId: number; quantity: number };

/**
 * Retire une pièce posée sur un OT et la remet en stock, en une transaction.
 * La suppression (`DELETE ... RETURNING`) décide seule du crédit : deux appels simultanés
 * ne créditent qu'une fois, le second reçoit 404. Si le crédit échoue, la ligne reste.
 */
export async function removePartUsed(id: number, actorUserId?: number): Promise<PartUsedRemoval> {
  const afterCommit: Array<() => void | Promise<void>> = [];
  try {
    const removal = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ workOrderStatus: workOrders.status })
        .from(partsUsed)
        .innerJoin(workOrders, eq(workOrders.id, partsUsed.workOrderId))
        .where(eq(partsUsed.id, id));
      if (!current) throw new AppError(404, "Pièce utilisée introuvable");
      if (CLOSED_WORK_ORDER_STATUSES.has(current.workOrderStatus)) {
        throw new AppError(
          409,
          "Cet ordre de travail est terminé : la pièce ne peut plus être retirée. Demandez un ajustement de stock au magasin.",
        );
      }

      const [deleted] = await tx.delete(partsUsed).where(eq(partsUsed.id, id)).returning();
      // Supprimée entre-temps par un autre appel : lui seul a crédité le stock.
      if (!deleted) throw new AppError(404, "Pièce utilisée introuvable");

      await storage.recordStockMovement(
        deleted.partId,
        "in",
        deleted.quantity,
        deleted.workOrderId,
        "Retour en stock - suppression de l'ordre de travail",
        actorUserId,
        { executor: tx, afterCommit: (effect) => afterCommit.push(effect) },
      );
      return {
        partUsedId: deleted.id,
        workOrderId: deleted.workOrderId,
        partId: deleted.partId,
        quantity: deleted.quantity,
      };
    });
    for (const effect of afterCommit) await effect();
    return removal;
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.error({ err: error, partUsedId: id }, "retrait de pièce posée en échec");
    throw new AppError(500, "Impossible de retirer la pièce de l'ordre de travail", { cause: error });
  }
}
