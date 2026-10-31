/**
 * Pointage (P-20, T-45). Une saisie par personne et par jour : `PUT` est un
 * upsert idempotent appuyé sur `uq_time_tracking_user_date`. `month` et `year`
 * viennent de la date, jamais du client. Les totaux mensuels sont calculés à la
 * lecture ; `monthly_time_stats` n'est pas utilisée.
 * Le code est validé ici (pas de CHECK en base : données historiques sales).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import {
  TIME_CODES,
  type TimeCode,
  type TimeTrackingEntry,
  type TimeTrackingMonthlyStatsResponse,
  type UpsertTimeTrackingRequest,
} from "@shared/contracts/time-tracking";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

export const timeTrackingService = {
  async upsert(input: UpsertTimeTrackingRequest): Promise<TimeTrackingEntry> {
    if (!(TIME_CODES as readonly string[]).includes(input.status)) {
      throw new AppError(400, "Code de pointage inconnu.");
    }
    const [y, m] = input.date.split("-").map(Number);
    const res = await db.execute(sql`
      INSERT INTO time_tracking (user_id, date, status, month, year, notes)
      VALUES (${input.userId}, ${input.date}::date, ${input.status}, ${m}, ${y}, ${input.notes ?? null})
      ON CONFLICT (user_id, date) DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes
      RETURNING user_id, to_char(date, 'YYYY-MM-DD') AS day, status, notes`);
    const r = rowsOf<{ user_id: number; day: string; status: TimeCode; notes: string | null }>(res)[0];
    return { userId: Number(r.user_id), date: r.day, status: r.status, notes: r.notes };
  },

  async list(q: { userId?: number; month: number; year: number }): Promise<TimeTrackingEntry[]> {
    const userId = q.userId ?? null;
    const res = await db.execute(sql`
      SELECT user_id, to_char(date, 'YYYY-MM-DD') AS day, status, notes
      FROM time_tracking
      WHERE month = ${q.month} AND year = ${q.year}
        AND (${userId}::int IS NULL OR user_id = ${userId}::int)
      ORDER BY date, user_id`);
    return rowsOf<{ user_id: number; day: string; status: TimeCode; notes: string | null }>(res).map((r) => ({
      userId: Number(r.user_id), date: r.day, status: r.status, notes: r.notes,
    }));
  },

  /**
   * Une ligne par personne pointée dans le mois, plus chaque compte chauffeur actif
   * sans saisie (compteurs à zéro) : la grille sert aussi à saisir le premier jour,
   * elle ne peut pas partir des seules personnes déjà pointées.
   * Actif = compte non supprimé et fiche `drivers` non désactivée (`is_active = false`).
   * Les saisies déjà faites restent affichées, même pour un chauffeur désactivé depuis.
   */
  async monthlyStats(q: { month: number; year: number }): Promise<TimeTrackingMonthlyStatsResponse> {
    const res = await db.execute(sql`
      SELECT u.id AS user_id, u.name, t.status, count(t.status)::int AS n
      FROM users u
      LEFT JOIN time_tracking t ON t.user_id = u.id AND t.month = ${q.month} AND t.year = ${q.year}
      WHERE t.user_id IS NOT NULL
         OR (u.role = 'driver' AND u.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = u.id AND d.is_active = false))
      GROUP BY u.id, u.name, t.status
      ORDER BY u.id`);
    const byUser = new Map<number, TimeTrackingMonthlyStatsResponse[number]>();
    for (const r of rowsOf<{ user_id: number; name: string; status: string; n: number }>(res)) {
      const id = Number(r.user_id);
      let entry = byUser.get(id);
      if (!entry) {
        entry = {
          userId: id,
          userName: r.name,
          counts: Object.fromEntries(TIME_CODES.map((c) => [c, 0])) as Record<TimeCode, number>,
        };
        byUser.set(id, entry);
      }
      if ((TIME_CODES as readonly string[]).includes(r.status)) entry.counts[r.status as TimeCode] = Number(r.n);
    }
    return [...byUser.values()];
  },
};
