/**
 * Échéance d'un OT préventif (CDC #7) : `work_orders.due_date` / `due_mileage`, figées à la
 * génération. `workOrders` (Drizzle) ne porte pas ces colonnes : elles s'écrivent par la table
 * compagnon `workOrderPlanning`, juste après l'insertion, dans la même transaction.
 *
 * Le rattrapage n'émet pas de second `work_order_updated` : la garde `fleetos.suppress_side_effects`
 * du déclencheur temps réel coupe l'événement du seul UPDATE d'échéance (l'événement de création
 * a déjà été émis par l'INSERT).
 */
import { eq, sql } from "drizzle-orm";
import { workOrderPlanning } from "@shared/schema";
import type { db } from "../db";

type Executor = Pick<typeof db, "execute" | "update">;

export type PreventiveDue = { dueDate: string; dueMileage?: number | null };

export async function stampPreventiveDue(tx: Executor, workOrderId: number, due: PreventiveDue): Promise<void> {
  await tx.execute(sql`SELECT set_config('fleetos.suppress_side_effects', 'on', true)`);
  await tx
    .update(workOrderPlanning)
    .set({ dueDate: due.dueDate, dueMileage: due.dueMileage ?? null })
    .where(eq(workOrderPlanning.id, workOrderId));
  await tx.execute(sql`SELECT set_config('fleetos.suppress_side_effects', '', true)`);
}
