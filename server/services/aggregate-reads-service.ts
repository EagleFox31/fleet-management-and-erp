/**
 * Lectures agrégées du lot recette (P-14, P-15, P-21, T-40). Lecture seule.
 *
 * Coût par véhicule : une sous-requête agrégée par source (main-d'oeuvre,
 * pièces, carburant), jamais de jointure directe entre sources (produit
 * cartésien, double comptage).
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { VehicleCostSummaryResponse } from "@shared/contracts/vehicle-cost-summary";
import type { TireMovement, TireMovementsQuery } from "@shared/contracts/tire-movements";
import type { PendingInvoice } from "@shared/contracts/pending-invoices";

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bornes ouvertes si absentes ; `to` inclus (borne haute exclusive +1 jour). */
function bounds(q: { from?: string; to?: string }) {
  return {
    from: q.from ?? "0001-01-01",
    toExclusive: q.to ? addDays(q.to, 1) : "9999-12-31",
  };
}

export const aggregateReadsService = {
  async vehicleCostSummary(
    vehicleId: number,
    q: { from?: string; to?: string } = {},
  ): Promise<VehicleCostSummaryResponse> {
    const { from, toExclusive } = bounds(q);
    const res = await db.execute(sql`
      SELECT
        COALESCE(wo.labor, 0)::float8 AS labor,
        COALESCE(wo.cnt, 0)::int AS work_order_count,
        COALESCE(pu.parts, 0)::float8 AS parts,
        COALESCE(fu.fuel, 0)::float8 AS fuel,
        COALESCE(fu.liters, 0)::float8 AS fuel_liters
      FROM (SELECT 1) one
      LEFT JOIN (
        SELECT SUM(cost) AS labor, count(*) AS cnt
        FROM work_orders
        WHERE vehicle_id = ${vehicleId} AND status <> 'cancelled'
          AND COALESCE(end_date, start_date, created_at) >= ${from}::timestamp
          AND COALESCE(end_date, start_date, created_at) < ${toExclusive}::timestamp
      ) wo ON true
      LEFT JOIN (
        SELECT SUM(p.quantity * p.unit_price) AS parts
        FROM parts_used p JOIN work_orders w ON w.id = p.work_order_id
        WHERE w.vehicle_id = ${vehicleId} AND w.status <> 'cancelled'
          AND COALESCE(w.end_date, w.start_date, w.created_at) >= ${from}::timestamp
          AND COALESCE(w.end_date, w.start_date, w.created_at) < ${toExclusive}::timestamp
      ) pu ON true
      LEFT JOIN (
        SELECT SUM(cost) AS fuel, SUM(quantity) AS liters
        FROM fuel_records
        WHERE vehicle_id = ${vehicleId} AND deleted_at IS NULL
          AND date >= ${from}::date AND date < ${toExclusive}::date
      ) fu ON true`);
    const r = rowsOf<Record<string, number>>(res)[0] ?? {};
    const labor = Math.round(Number(r.labor ?? 0));
    const parts = Math.round(Number(r.parts ?? 0));
    const fuel = Math.round(Number(r.fuel ?? 0));
    return {
      vehicleId,
      from: q.from ?? null,
      to: q.to ?? null,
      labor,
      parts,
      fuel,
      total: labor + parts + fuel,
      workOrderCount: Number(r.work_order_count ?? 0),
      fuelLiters: Number(r.fuel_liters ?? 0),
    };
  },

  async tireMovements(q: TireMovementsQuery): Promise<TireMovement[]> {
    const { from, toExclusive } = bounds(q);
    const tireId = q.tireId ?? null;
    const vehicleId = q.vehicleId ?? null;
    const res = await db.execute(sql`
      SELECT m.*, to_char(m.at, 'YYYY-MM-DD') AS day, t.brand, t.model, t.size, v.registration_number FROM (
        SELECT 'installed' AS kind, vt.installation_date::timestamp AS at, vt.tire_id, vt.vehicle_id,
               vt.position, vt.installation_mileage AS mileage, NULL::text AS by_name
        FROM vehicle_tires vt
        UNION ALL
        SELECT 'removed', vt.removal_date::timestamp, vt.tire_id, vt.vehicle_id,
               vt.position, vt.removal_mileage, NULL::text
        FROM vehicle_tires vt WHERE vt.removal_date IS NOT NULL
        UNION ALL
        SELECT 'rotated', r.rotation_date::timestamp, vt.tire_id, r.vehicle_id,
               d.to_position, r.rotation_mileage, u.name
        FROM tire_rotation_details d
        JOIN tire_rotations r ON r.id = d.rotation_id
        JOIN vehicle_tires vt ON vt.id = d.vehicle_tire_id
        LEFT JOIN users u ON u.id = r.performed_by
        UNION ALL
        SELECT 'inspected', i.inspection_date::timestamp, vt.tire_id, vt.vehicle_id,
               vt.position, i.inspection_mileage, u.name
        FROM tire_inspections i
        JOIN vehicle_tires vt ON vt.id = i.vehicle_tire_id
        LEFT JOIN users u ON u.id = i.inspected_by
      ) m
      JOIN tires t ON t.id = m.tire_id
      LEFT JOIN vehicles v ON v.id = m.vehicle_id
      WHERE m.at >= ${from}::timestamp AND m.at < ${toExclusive}::timestamp
        AND (${tireId}::int IS NULL OR m.tire_id = ${tireId}::int)
        AND (${vehicleId}::int IS NULL OR m.vehicle_id = ${vehicleId}::int)
      ORDER BY m.at DESC, m.tire_id, m.kind
      LIMIT 500`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      kind: r.kind as TireMovement["kind"],
      at: `${String(r.day)}T00:00:00.000Z`,
      tireId: Number(r.tire_id),
      tireLabel: `${r.brand ?? ""} ${r.model ?? ""} ${r.size ?? ""}`.trim(),
      vehicleId: r.vehicle_id == null ? null : Number(r.vehicle_id),
      vehicleLabel: (r.registration_number as string | null) ?? null,
      position: (r.position as string | null) ?? null,
      mileage: r.mileage == null ? null : Number(r.mileage),
      byUserName: (r.by_name as string | null) ?? null,
    }));
  },

  /**
   * Missions terminées sans facture client active, par client. `amount` somme les prix
   * convenus (`missions.agreed_price`) ; une mission sans prix n'est pas valorisée à 0 en
   * silence, elle est comptée à part dans `missionsWithoutPrice`.
   */
  async pendingInvoices(): Promise<PendingInvoice[]> {
    const res = await db.execute(sql`
      SELECT c.id AS client_id, c.name AS client_name, count(*)::int AS operation_count,
             COALESCE(sum(m.agreed_price), 0)::float8 AS amount,
             (count(*) FILTER (WHERE m.agreed_price IS NULL))::int AS without_price,
             to_char(min(COALESCE(m.completed_at, m.delivery_date, m.created_at)), 'YYYY-MM-DD') AS oldest
      FROM missions m
      JOIN clients c ON c.id = m.client_id
      WHERE m.status IN ('delivered', 'completed')
        AND NOT EXISTS (
          SELECT 1 FROM client_invoices i WHERE i.mission_id = m.id AND i.status <> 'cancelled'
        )
      GROUP BY c.id, c.name
      ORDER BY min(COALESCE(m.completed_at, m.delivery_date, m.created_at)) ASC`);
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      clientId: Number(r.client_id),
      clientName: String(r.client_name),
      operationCount: Number(r.operation_count),
      amount: Number(r.amount),
      missionsWithoutPrice: Number(r.without_price),
      oldestOperationDate: String(r.oldest),
    }));
  },
};
