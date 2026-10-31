/**
 * Résolution des anomalies carburant (P-18, T-42).
 *
 * Les anomalies sont calculées : la clé stable `<règle>:<fuel_record_id>`
 * identifie l'anomalie. Une nouvelle décision remplace la précédente (upsert
 * sur `anomaly_key`), donc rejouable. L'événement temps réel
 * `fuel_anomaly_resolved` est émis par la route, après le retour de ce service.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import type { FuelAnomaly, FuelAnomalyResolution, UpdateFuelAnomalyRequest } from "@shared/contracts/fuel-anomalies";
import { fuelAnomalyKeySchema } from "@shared/contracts/fuel-anomalies";

type Row = {
  anomaly_key: string;
  fuel_record_id: number;
  status: FuelAnomalyResolution["status"];
  comment: string | null;
  resolved_by: number | null;
  iso: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

const toResolution = (r: Row): FuelAnomalyResolution => ({
  anomalyKey: r.anomaly_key,
  fuelRecordId: Number(r.fuel_record_id),
  status: r.status,
  comment: r.comment,
  resolvedBy: r.resolved_by == null ? null : Number(r.resolved_by),
  resolvedAt: r.iso,
});

const RETURNING = sql`anomaly_key, fuel_record_id, status, comment, resolved_by,
  to_char(resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso`;

export const fuelAnomalyResolutionService = {
  async resolve(anomalyKey: string, input: UpdateFuelAnomalyRequest, userId: number): Promise<FuelAnomalyResolution> {
    if (!fuelAnomalyKeySchema.safeParse(anomalyKey).success) {
      throw new AppError(400, "Clé d'anomalie invalide.");
    }
    const fuelRecordId = Number(anomalyKey.split(":")[1]);
    const exists = rowsOf(await db.execute(sql`SELECT 1 FROM fuel_records WHERE id = ${fuelRecordId}`));
    if (exists.length === 0) throw new AppError(404, "Plein introuvable pour cette anomalie.");

    const res = await db.execute(sql`
      INSERT INTO fuel_anomaly_resolutions (anomaly_key, fuel_record_id, status, comment, resolved_by, resolved_at)
      VALUES (${anomalyKey}, ${fuelRecordId}, ${input.status}, ${input.comment ?? null}, ${userId}, now())
      ON CONFLICT (anomaly_key) DO UPDATE SET
        status = EXCLUDED.status,
        comment = EXCLUDED.comment,
        resolved_by = EXCLUDED.resolved_by,
        resolved_at = now()
      RETURNING ${RETURNING}`);
    return toResolution(rowsOf<Row>(res)[0]);
  },

  async get(anomalyKey: string): Promise<FuelAnomalyResolution | null> {
    const res = await db.execute(sql`
      SELECT ${RETURNING} FROM fuel_anomaly_resolutions WHERE anomaly_key = ${anomalyKey}`);
    const row = rowsOf<Row>(res)[0];
    return row ? toResolution(row) : null;
  },

  /**
   * Anomalies calculées (règle `consumption-gap`, voir le contrat), avec la dernière décision.
   * Même critère que `fuelCardService.detectAnomalies`, sur toute la flotte. Lecture seule.
   */
  async list(): Promise<FuelAnomaly[]> {
    const res = await db.execute(sql`
      WITH base AS (
        SELECT fr.id, fr.vehicle_id, fr.date, fr.quantity,
               AVG(fr.quantity) OVER w AS avg_q, STDDEV_POP(fr.quantity) OVER w AS sd_q, COUNT(*) OVER w AS n
          FROM fuel_records fr
         WHERE fr.vehicle_id IS NOT NULL AND fr.debit_amount > 0
        WINDOW w AS (PARTITION BY fr.vehicle_id)
      )
      SELECT b.id, b.vehicle_id, to_char(b.date, 'YYYY-MM-DD') AS day, b.quantity, b.avg_q,
             b.avg_q + 2 * b.sd_q AS threshold, v.registration_number AS vehicle_label,
             r.status, r.comment, to_char(r.resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
        FROM base b
        LEFT JOIN vehicles v ON v.id = b.vehicle_id
        LEFT JOIN fuel_anomaly_resolutions r ON r.anomaly_key = 'consumption-gap:' || b.id
       WHERE b.n >= 3 AND b.quantity > b.avg_q + 2 * b.sd_q
       ORDER BY b.date DESC NULLS LAST, b.id DESC
       LIMIT 500`);
    type ListRow = {
      id: number; vehicle_id: number; day: string | null; quantity: number; avg_q: string | number;
      threshold: string | number; vehicle_label: string | null; status: FuelAnomaly["status"] | null;
      comment: string | null; iso: string | null;
    };
    return rowsOf<ListRow>(res).map((r) => ({
      anomalyKey: `consumption-gap:${r.id}`,
      rule: "consumption-gap",
      fuelRecordId: Number(r.id),
      date: r.day,
      vehicleId: Number(r.vehicle_id),
      vehicleLabel: r.vehicle_label,
      quantity: Number(r.quantity),
      averageQuantity: Math.round(Number(r.avg_q)),
      threshold: Math.round(Number(r.threshold)),
      status: r.status ?? "open",
      comment: r.comment,
      resolvedAt: r.iso,
    }));
  },

  /** Clés à retirer de la liste active : les anomalies justifiées. */
  async justifiedKeys(): Promise<Set<string>> {
    const res = await db.execute(sql`SELECT anomaly_key FROM fuel_anomaly_resolutions WHERE status = 'justified'`);
    return new Set(rowsOf<{ anomaly_key: string }>(res).map((r) => r.anomaly_key));
  },
};
