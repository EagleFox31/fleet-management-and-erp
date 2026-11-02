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

/**
 * Tolérance de la règle `tank-overflow`, en pour cent au-dessus de la capacité (jauge, pleins en
 * dépassement légitimes). Valeur provisoire à confirmer par le client : un seul endroit à changer.
 */
export const TANK_OVERFLOW_TOLERANCE_PERCENT = 5;

// Constante du module, jamais une saisie : insérée telle quelle pour que Postgres la type en entier.
const TOLERANCE_SQL = sql.raw(String(Math.trunc(TANK_OVERFLOW_TOLERANCE_PERCENT)));

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
   * Anomalies calculées, avec la dernière décision. Trois règles, lecture seule, toute la flotte :
   * - `consumption-gap` : même critère que `fuelCardService.detectAnomalies` (au moins trois pleins
   *   débités). Elle ne regarde PAS `full_tank` : la quantité servie est comparée à la moyenne des
   *   quantités, plein complet ou partiel.
   * - `tank-overflow` : quantité servie supérieure à la capacité du véhicule majorée de la tolérance ;
   *   muette sans capacité renseignée.
   * - `odometer-regression` : kilométrage inférieur à celui du plein précédent du même véhicule
   *   (ordre date puis id) ; kilométrage nul ou 0 = absent (le « précédent » est le dernier plein à
   *   kilométrage connu), premier plein = rien à comparer, plein sans date exclu.
   * Les deux dernières ignorent les pleins sans véhicule (recharges de la carte) et `electric`.
   */
  async list(): Promise<FuelAnomaly[]> {
    const res = await db.execute(sql`
      WITH base AS (
        SELECT fr.id, fr.vehicle_id, fr.date, fr.quantity,
               AVG(fr.quantity) OVER w AS avg_q, STDDEV_POP(fr.quantity) OVER w AS sd_q, COUNT(*) OVER w AS n
          FROM fuel_records fr
         WHERE fr.vehicle_id IS NOT NULL AND fr.debit_amount > 0
        WINDOW w AS (PARTITION BY fr.vehicle_id)
      ),
      gap AS (
        SELECT 'consumption-gap'::text AS rule, b.id, b.vehicle_id, b.date, b.quantity,
               b.avg_q::numeric AS reference, (b.avg_q + 2 * b.sd_q)::numeric AS threshold,
               NULL::integer AS mileage, NULL::integer AS previous_mileage, NULL::real AS tank_capacity_l
          FROM base b
         WHERE b.n >= 3 AND b.quantity > b.avg_q + 2 * b.sd_q
      ),
      overflow AS (
        -- Comparaison en numérique, sans flottant : quantité * 100 > capacité * (100 + tolérance).
        SELECT 'tank-overflow'::text AS rule, fr.id, fr.vehicle_id, fr.date, fr.quantity,
               v.tank_capacity_l::numeric AS reference,
               v.tank_capacity_l::numeric * (100 + ${TOLERANCE_SQL}) / 100 AS threshold,
               NULL::integer AS mileage, NULL::integer AS previous_mileage, v.tank_capacity_l AS tank_capacity_l
          FROM fuel_records fr
          JOIN vehicles v ON v.id = fr.vehicle_id
         WHERE fr.vehicle_id IS NOT NULL
           AND fr.fuel_type IS DISTINCT FROM 'electric'
           AND v.tank_capacity_l IS NOT NULL
           AND fr.quantity::numeric * 100 > v.tank_capacity_l::numeric * (100 + ${TOLERANCE_SQL})
      ),
      readings AS (
        SELECT fr.id, fr.vehicle_id, fr.date, fr.quantity, fr.mileage,
               LAG(fr.mileage) OVER (PARTITION BY fr.vehicle_id ORDER BY fr.date, fr.id) AS previous_mileage
          FROM fuel_records fr
         WHERE fr.vehicle_id IS NOT NULL
           AND fr.date IS NOT NULL
           AND fr.fuel_type IS DISTINCT FROM 'electric'
           AND fr.mileage > 0
      ),
      regression AS (
        SELECT 'odometer-regression'::text AS rule, rd.id, rd.vehicle_id, rd.date, rd.quantity,
               rd.previous_mileage::numeric AS reference, rd.previous_mileage::numeric AS threshold,
               rd.mileage AS mileage, rd.previous_mileage AS previous_mileage, NULL::real AS tank_capacity_l
          FROM readings rd
         WHERE rd.mileage < rd.previous_mileage
      ),
      found AS (
        SELECT * FROM gap UNION ALL SELECT * FROM overflow UNION ALL SELECT * FROM regression
      )
      SELECT f.rule, f.id, f.vehicle_id, to_char(f.date, 'YYYY-MM-DD') AS day, f.quantity, f.reference, f.threshold,
             f.mileage, f.previous_mileage, f.tank_capacity_l, v.registration_number AS vehicle_label,
             r.status, r.comment, to_char(r.resolved_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso
        FROM found f
        LEFT JOIN vehicles v ON v.id = f.vehicle_id
        LEFT JOIN fuel_anomaly_resolutions r ON r.anomaly_key = f.rule || ':' || f.id
       ORDER BY f.date DESC NULLS LAST, f.id DESC, f.rule
       LIMIT 500`);
    type ListRow = {
      rule: FuelAnomaly["rule"]; id: number; vehicle_id: number; day: string | null; quantity: number;
      reference: string | number; threshold: string | number; mileage: number | null;
      previous_mileage: number | null; tank_capacity_l: number | null; vehicle_label: string | null;
      status: FuelAnomaly["status"] | null; comment: string | null; iso: string | null;
    };
    return rowsOf<ListRow>(res).map((r) => ({
      anomalyKey: `${r.rule}:${r.id}`,
      rule: r.rule,
      fuelRecordId: Number(r.id),
      date: r.day,
      vehicleId: Number(r.vehicle_id),
      vehicleLabel: r.vehicle_label,
      quantity: Number(r.quantity),
      // Valeur de référence : moyenne (consumption-gap), capacité (tank-overflow), kilométrage précédent (odometer-regression).
      averageQuantity: Math.round(Number(r.reference)),
      // Seuil franchi : moyenne + 2 écarts-types, capacité + tolérance, kilométrage précédent.
      threshold: Math.round(Number(r.threshold)),
      ...(r.rule === "odometer-regression"
        ? {
            mileage: r.mileage == null ? null : Number(r.mileage),
            previousMileage: r.previous_mileage == null ? null : Number(r.previous_mileage),
          }
        : {}),
      ...(r.rule === "tank-overflow"
        ? { tankCapacityL: r.tank_capacity_l == null ? null : Number(r.tank_capacity_l) }
        : {}),
      status: r.status ?? "open",
      comment: r.comment,
      resolvedAt: r.iso,
    }));
  },

  /** Véhicules (hors retirés) sans capacité de réservoir : la règle `tank-overflow` y est muette. */
  async vehiclesWithoutTankCapacity(): Promise<number> {
    const res = await db.execute(sql`
      SELECT count(*) FILTER (WHERE tank_capacity_l IS NULL AND deleted_at IS NULL) AS n FROM vehicles`);
    return Number(rowsOf<{ n: string | number }>(res)[0]?.n ?? 0);
  },

  /** Clés à retirer de la liste active : les anomalies justifiées. */
  async justifiedKeys(): Promise<Set<string>> {
    const res = await db.execute(sql`SELECT anomaly_key FROM fuel_anomaly_resolutions WHERE status = 'justified'`);
    return new Set(rowsOf<{ anomaly_key: string }>(res).map((r) => r.anomaly_key));
  },
};
