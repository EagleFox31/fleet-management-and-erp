/**
 * KPI de pilotage (P-10, T-25, chantier CDC #7). Lecture seule.
 *
 * Le SQL ramène des lignes, `server/lib/kpi-rules.ts` décide (testé sans base). Définitions :
 * - panne : déclaration (`incidents`) ou OT correctif non annulé qu'aucune déclaration ne
 *   référence (`incidents.work_order_id`) : un même événement n'est jamais compté deux fois.
 *   Série mensuelle complète (mois à zéro compris), moyenne = total / nombre de mois ;
 * - préventif : occurrence échue = OT préventif d'échéance `COALESCE(due_date, start_date::date)`
 *   dans [from, min(to, hier)] (Africa/Douala), plus les planifications actives échues qui n'ont
 *   aucun OT préventif. Réalisé à temps : `completed` et clos au plus tard à l'échéance plus la
 *   tolérance (`KPI_PREVENTIVE_TOLERANCE_DAYS`, 0 par défaut). Annulé = non réalisé ;
 * - coût d'une intervention : OT `completed` dont `end_date` tombe dans la période, main-d'oeuvre
 *   (heures réelles x taux en vigueur, sinon `work_orders.cost`) + pièces (`parts_used`)
 *   + rotations de pneus (`tire_rotations`), comme l'écran et le PDF de l'OT. Montants en FCFA
 *   entiers, hors taxes.
 *
 * Pièces, pneus et heures sont agrégés par OT dans des sous-requêtes : jamais de somme jointe
 * (double comptage, cf. shared/schema.ts, work_orders).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { workOrderPlanning } from "@shared/schema";
import type {
  AvgCostPerInterventionResponse,
  FailuresResponse,
  IncidentsPerMonthResponse,
  KpiQuery,
  MaintenanceCostsQuery,
  MaintenanceCostsResponse,
  PreventiveComplianceResponse,
} from "@shared/contracts/kpi";
import {
  type CostRow,
  type LaborRate,
  averageCost,
  fillMonthSeries,
  groupCosts,
  isoDateInZone,
  laborRateAt,
  monthKeysBetween,
  monthlyAverage,
  parseToleranceDays,
  preventiveWindowEnd,
  resolveKpiWindow,
  summarizePreventive,
  workOrderCost,
} from "../lib/kpi-rules";

export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

type FailureRow = { month: string; vehicle_id: number; registration_number: string; count: number };

async function loadFailures(from: string, toExclusive: string): Promise<FailureRow[]> {
  const res = await db.execute(sql`
    WITH events AS (
      SELECT i.vehicle_id, i.created_at AS at
      FROM incidents i
      WHERE i.created_at >= ${from}::timestamp AND i.created_at < ${toExclusive}::timestamp
      UNION ALL
      SELECT w.vehicle_id, COALESCE(w.start_date, w.created_at) AS at
      FROM work_orders w
      WHERE w.is_preventive IS NOT TRUE
        AND w.status <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.work_order_id = w.id)
        AND COALESCE(w.start_date, w.created_at) >= ${from}::timestamp
        AND COALESCE(w.start_date, w.created_at) < ${toExclusive}::timestamp
    )
    SELECT to_char(e.at, 'YYYY-MM') AS month, e.vehicle_id, v.registration_number, count(*)::int AS count
    FROM events e
    JOIN vehicles v ON v.id = e.vehicle_id
    GROUP BY 1, 2, 3`);
  return rowsOf<FailureRow>(res).map((r) => ({ ...r, vehicle_id: Number(r.vehicle_id), count: Number(r.count) }));
}

type CostSource = {
  id: number;
  vehicle_id: number;
  registration_number: string;
  is_preventive: boolean | null;
  cost: string | number | null;
  hours: string | number | null;
  parts: string | number | null;
  tires: string | number | null;
  done_on: string;
};

async function loadCostRows(from: string, toExclusive: string): Promise<{ rows: CostRow[]; laborValued: boolean }> {
  const [rateRes, costRes] = await Promise.all([
    db.execute(sql`
      SELECT to_char(effective_from, 'YYYY-MM-DD') AS effective_from, hourly_rate_ht::float8 AS hourly_rate_ht
      FROM workshop_labor_rates`),
    db.execute(sql`
      SELECT w.id, w.vehicle_id, v.registration_number, w.is_preventive, w.cost,
             to_char(w.end_date, 'YYYY-MM-DD') AS done_on,
             (SELECT COALESCE(SUM(i.actual_hours), 0) FROM work_order_items i
               WHERE i.work_order_id = w.id AND i.status <> 'cancelled') AS hours,
             (SELECT COALESCE(SUM(pu.quantity * pu.unit_price), 0) FROM parts_used pu
               WHERE pu.work_order_id = w.id) AS parts,
             (SELECT COALESCE(SUM(tr.cost), 0) FROM tire_rotations tr
               WHERE tr.work_order_id = w.id) AS tires
      FROM work_orders w
      JOIN vehicles v ON v.id = w.vehicle_id
      WHERE w.status = 'completed'
        AND w.end_date >= ${from}::timestamp
        AND w.end_date < ${toExclusive}::timestamp`),
  ]);
  const rates: LaborRate[] = rowsOf<{ effective_from: string; hourly_rate_ht: number }>(rateRes).map((r) => ({
    effectiveFrom: r.effective_from,
    hourlyRateHt: Number(r.hourly_rate_ht),
  }));
  const rows = rowsOf<CostSource>(costRes).map((r): CostRow => {
    const cost = workOrderCost({
      cost: Number(r.cost ?? 0),
      hours: Number(r.hours ?? 0),
      rate: laborRateAt(rates, r.done_on),
      parts: Number(r.parts ?? 0),
      tires: Number(r.tires ?? 0),
    });
    return { ...cost, key: String(r.vehicle_id), label: r.registration_number, isPreventive: r.is_preventive === true };
  });
  return { rows, laborValued: rates.length > 0 };
}

function sum(rows: readonly CostRow[], pick: (r: CostRow) => number): number {
  return rows.reduce((acc, r) => acc + pick(r), 0);
}

export const kpiService = {
  /** Pannes par mois (déclarations + OT correctifs sans déclaration), mois à zéro compris. */
  async incidentsPerMonth(query: KpiQuery, now: Date = new Date()): Promise<IncidentsPerMonthResponse> {
    const { from, to, toExclusive } = resolveKpiWindow(query, now);
    const rows = await loadFailures(from, toExclusive);
    const perMonth = new Map<string, number>();
    for (const r of rows) perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + r.count);
    return fillMonthSeries([...perMonth].map(([month, count]) => ({ month, count })), from, to);
  },

  async failures(query: KpiQuery, now: Date = new Date()): Promise<FailuresResponse> {
    const { from, to, toExclusive } = resolveKpiWindow(query, now);
    const rows = await loadFailures(from, toExclusive);
    const perMonth = new Map<string, number>();
    const perVehicle = new Map<number, { vehicleId: number; registrationNumber: string; count: number }>();
    for (const r of rows) {
      perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + r.count);
      const v = perVehicle.get(r.vehicle_id) ?? { vehicleId: r.vehicle_id, registrationNumber: r.registration_number, count: 0 };
      v.count += r.count;
      perVehicle.set(r.vehicle_id, v);
    }
    const series = fillMonthSeries([...perMonth].map(([month, count]) => ({ month, count })), from, to);
    const total = series.reduce((acc, m) => acc + m.count, 0);
    const months = Math.max(1, monthKeysBetween(from, to).length);
    return {
      from,
      to,
      months,
      total,
      monthlyAverage: monthlyAverage(total, months),
      series,
      byVehicle: [...perVehicle.values()].sort(
        (a, b) => b.count - a.count || a.registrationNumber.localeCompare(b.registrationNumber),
      ),
    };
  },

  async preventiveCompliance(query: KpiQuery, now: Date = new Date()): Promise<PreventiveComplianceResponse> {
    const { from, to } = resolveKpiWindow(query, now);
    const toleranceDays = parseToleranceDays(process.env.KPI_PREVENTIVE_TOLERANCE_DAYS);
    const periodEnd = preventiveWindowEnd(to, isoDateInZone(now));
    const due = sql`COALESCE(${workOrderPlanning.dueDate}, work_orders.start_date::date)`;

    const [occRes, uncoveredRes] = await Promise.all([
      db.execute(sql`
        SELECT status, (${due})::text AS due, to_char(end_date, 'YYYY-MM-DD') AS done_on
        FROM work_orders
        WHERE is_preventive IS TRUE
          AND ${due} >= ${from}::date
          AND ${due} <= ${periodEnd}::date`),
      db.execute(sql`
        SELECT count(*)::int AS n
        FROM maintenance_schedules ms
        WHERE ms.is_active IS TRUE
          AND ms.scheduled_date >= ${from}::date
          AND ms.scheduled_date <= ${periodEnd}::date
          AND NOT EXISTS (
            SELECT 1 FROM work_orders w WHERE w.maintenance_schedule_id = ms.id AND w.is_preventive IS TRUE
          )`),
    ]);
    const occurrences = rowsOf<{ status: string; due: string; done_on: string | null }>(occRes).map((r) => ({
      status: r.status,
      due: r.due,
      doneOn: r.done_on,
    }));
    const uncovered = Number(rowsOf<{ n: number }>(uncoveredRes)[0]?.n ?? 0);
    const s = summarizePreventive(occurrences, uncovered, toleranceDays);
    return { ...s, toleranceDays, periodEnd };
  },

  async avgCostPerIntervention(query: KpiQuery, now: Date = new Date()): Promise<AvgCostPerInterventionResponse> {
    const { from, toExclusive } = resolveKpiWindow(query, now);
    const { rows, laborValued } = await loadCostRows(from, toExclusive);
    const totalCost = sum(rows, (r) => r.total);
    return {
      interventions: rows.length,
      totalCost,
      averageCost: averageCost(totalCost, rows.length),
      laborValued,
      laborTotal: sum(rows, (r) => r.labor),
      partsTotal: sum(rows, (r) => r.parts),
      tiresTotal: sum(rows, (r) => r.tires),
      missingCostCount: rows.filter((r) => r.laborMissing).length,
    };
  },

  async maintenanceCosts(query: MaintenanceCostsQuery, now: Date = new Date()): Promise<MaintenanceCostsResponse> {
    const { from, toExclusive } = resolveKpiWindow(query, now);
    const { rows, laborValued } = await loadCostRows(from, toExclusive);
    const totalCost = sum(rows, (r) => r.total);

    let groups = groupCosts(rows, (r) =>
      query.groupBy === "type"
        ? r.isPreventive
          ? { key: "preventive", label: "Préventif" }
          : { key: "corrective", label: "Correctif" }
        : { key: r.key, label: r.label },
    );
    if (query.groupBy === "type") {
      const byKey = new Map(groups.map((g) => [g.key, g]));
      groups = [
        byKey.get("preventive") ?? { key: "preventive", label: "Préventif", interventions: 0, totalCost: 0, averageCost: null },
        byKey.get("corrective") ?? { key: "corrective", label: "Correctif", interventions: 0, totalCost: 0, averageCost: null },
      ];
    } else {
      groups.sort((a, b) => b.totalCost - a.totalCost || a.label.localeCompare(b.label));
    }
    return {
      groupBy: query.groupBy,
      laborValued,
      missingCostCount: rows.filter((r) => r.laborMissing).length,
      total: { interventions: rows.length, totalCost, averageCost: averageCost(totalCost, rows.length) },
      groups,
    };
  },
};
