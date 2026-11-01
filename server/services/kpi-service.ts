/**
 * KPI de la direction (P-10, T-25). Lecture seule, SQL agrégé.
 *
 * Définitions (documentées par tests/integration/kpi-service.test.ts) :
 * - incident : OT non préventif et non annulé, daté de la panne
 *   (`COALESCE(start_date, created_at)`) ;
 * - préventif échu : OT préventif non annulé dont `start_date` (date prévue)
 *   tombe dans la période ; réalisé à temps : clos et `end_date` au plus tard
 *   le jour prévu + `duration` minutes ;
 * - coût d'une intervention : OT clos, `work_orders.cost` (main-d'oeuvre) +
 *   pièces. Les pièces sont agrégées à part (`parts_used` par OT) : jamais de
 *   somme jointe, sinon double comptage (cf. shared/schema.ts, work_orders).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import type {
  AvgCostPerInterventionResponse,
  IncidentsPerMonthResponse,
  KpiQuery,
  PreventiveComplianceResponse,
} from "@shared/contracts/kpi";

type Bounds = { from: string; toExclusive: string };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sans période : les 12 derniers mois. Bornes incluses, `to` exclu après +1 jour. */
export function resolveKpiBounds(query: KpiQuery, now: Date = new Date()): Bounds {
  const today = now.toISOString().slice(0, 10);
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -365);
  return { from, toExclusive: addDays(to, 1) };
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

export const kpiService = {
  async incidentsPerMonth(query: KpiQuery): Promise<IncidentsPerMonthResponse> {
    const { from, toExclusive } = resolveKpiBounds(query);
    const res = await db.execute(sql`
      SELECT to_char(date_trunc('month', COALESCE(start_date, created_at)), 'YYYY-MM') AS month,
             count(*)::int AS count
      FROM work_orders
      WHERE is_preventive IS NOT TRUE
        AND status <> 'cancelled'
        AND COALESCE(start_date, created_at) >= ${from}::timestamp
        AND COALESCE(start_date, created_at) < ${toExclusive}::timestamp
      GROUP BY 1
      ORDER BY 1`);
    return rowsOf<{ month: string; count: number }>(res).map((r) => ({
      month: r.month,
      count: Number(r.count),
    }));
  },

  async preventiveCompliance(query: KpiQuery): Promise<PreventiveComplianceResponse> {
    const { from, toExclusive } = resolveKpiBounds(query);
    const res = await db.execute(sql`
      SELECT count(*)::int AS planned,
             (count(*) FILTER (
               WHERE status = 'completed'
                 AND end_date IS NOT NULL
                 AND end_date::date <= (start_date + make_interval(mins => COALESCE(duration, 0)))::date
             ))::int AS done_on_time
      FROM work_orders
      WHERE is_preventive IS TRUE
        AND status <> 'cancelled'
        AND start_date >= ${from}::timestamp
        AND start_date < ${toExclusive}::timestamp`);
    const row = rowsOf<{ planned: number; done_on_time: number }>(res)[0];
    const planned = Number(row?.planned ?? 0);
    const doneOnTime = Number(row?.done_on_time ?? 0);
    return { planned, doneOnTime, rate: planned === 0 ? null : doneOnTime / planned };
  },

  async avgCostPerIntervention(query: KpiQuery): Promise<AvgCostPerInterventionResponse> {
    const { from, toExclusive } = resolveKpiBounds(query);
    const res = await db.execute(sql`
      SELECT count(*)::int AS interventions,
             (COALESCE(SUM(w.cost), 0) + COALESCE(SUM(p.total), 0) + COALESCE(SUM(r.total), 0))::float8 AS total_cost
      FROM work_orders w
      LEFT JOIN (
        SELECT work_order_id, SUM(quantity * unit_price) AS total
        FROM parts_used
        GROUP BY work_order_id
      ) p ON p.work_order_id = w.id
      -- Rotations agrégées à part, comme les pièces : pas de produit cartésien (WO5).
      LEFT JOIN (
        SELECT work_order_id, SUM(cost) AS total
        FROM tire_rotations
        GROUP BY work_order_id
      ) r ON r.work_order_id = w.id
      WHERE w.status = 'completed'
        AND COALESCE(w.end_date, w.start_date, w.created_at) >= ${from}::timestamp
        AND COALESCE(w.end_date, w.start_date, w.created_at) < ${toExclusive}::timestamp`);
    const row = rowsOf<{ interventions: number; total_cost: number }>(res)[0];
    const interventions = Number(row?.interventions ?? 0);
    const totalCost = Math.round(Number(row?.total_cost ?? 0));
    return {
      interventions,
      totalCost,
      averageCost: interventions === 0 ? null : Math.round(totalCost / interventions),
    };
  },
};
