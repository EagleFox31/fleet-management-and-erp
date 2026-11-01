import { and, eq } from "drizzle-orm";
import { alerts, type Alert } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";

/**
 * Boîte d'alertes de l'utilisateur connecté (ALR2).
 *
 * Toute écriture est filtrée sur `user_id` : une alerte d'un autre compte
 * répond 404, comme une alerte inexistante, pour ne pas révéler son existence.
 * Les écritures sont idempotentes : relire une alerte lue ne change rien.
 */
export const alertInboxService = {
  async markRead(userId: number, alertId: number): Promise<Alert> {
    const [row] = await db
      .update(alerts)
      .set({ isRead: true })
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning();
    if (!row) throw new AppError(404, "Alerte introuvable.");
    return row;
  },

  /** Marque lues toutes les alertes non lues de l'utilisateur ; renvoie les ids touchés. */
  async markAllRead(userId: number): Promise<number[]> {
    const rows = await db
      .update(alerts)
      .set({ isRead: true })
      .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)))
      .returning({ id: alerts.id });
    return rows.map((row) => row.id);
  },

  async remove(userId: number, alertId: number): Promise<void> {
    const rows = await db
      .delete(alerts)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning({ id: alerts.id });
    if (rows.length === 0) throw new AppError(404, "Alerte introuvable.");
  },
};
