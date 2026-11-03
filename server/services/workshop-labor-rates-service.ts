import { desc, sql } from "drizzle-orm";
import type { CreateWorkshopLaborRateRequest, WorkshopLaborRate } from "@shared/contracts/workshop-labor-rates";
import { workshopLaborRates, type WorkshopLaborRateRow } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("workshop-labor-rates");

const UNIQUE_DATE_CONSTRAINT = "workshop_labor_rates_effective_from_key";

function toRate(row: WorkshopLaborRateRow): WorkshopLaborRate {
  return {
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    hourlyRateHt: Number(row.hourlyRateHt),
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}

/** Le pilote remonte le code SQLSTATE sur l'erreur ou, sous Drizzle, sur sa `cause`. */
function pgErrorOf(error: unknown): { code?: string; constraint?: string } {
  const own = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: own?.code ?? own?.cause?.code, constraint: own?.constraint ?? own?.cause?.constraint };
}

/** Tous les taux, du plus récent au plus ancien. */
export async function listWorkshopLaborRates(): Promise<WorkshopLaborRate[]> {
  const rows = await db.select().from(workshopLaborRates).orderBy(desc(workshopLaborRates.effectiveFrom));
  return rows.map(toRate);
}

/** Date qui choisit le taux d'un OT `w` : sa clôture, sinon aujourd'hui en Africa/Douala. */
const RATE_DATE_OF_WORK_ORDER = sql`COALESCE(w.end_date::date, (now() AT TIME ZONE 'Africa/Douala')::date)`;

/**
 * Taux en vigueur pour un OT : à sa date de clôture (`end_date`, comme le KPI de coût), sinon
 * aujourd'hui en Africa/Douala pour un OT en cours. `null` s'il n'existe aucun taux à cette date.
 */
export async function laborRateForWorkOrder(workOrderId: number): Promise<{ effectiveFrom: string; hourlyRateHt: number } | null> {
  const res = await db.execute(sql`
    SELECT to_char(r.effective_from, 'YYYY-MM-DD') AS effective_from, r.hourly_rate_ht::float8 AS hourly_rate_ht
    FROM work_orders w
    JOIN workshop_labor_rates r
      ON r.effective_from <= ${RATE_DATE_OF_WORK_ORDER}
    WHERE w.id = ${workOrderId}
    ORDER BY r.effective_from DESC
    LIMIT 1`);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{
    effective_from: string;
    hourly_rate_ht: number;
  }>;
  const row = rows[0];
  return row ? { effectiveFrom: row.effective_from, hourlyRateHt: Number(row.hourly_rate_ht) } : null;
}

/**
 * Taux horaire en vigueur pour plusieurs OT, en une requête (même règle que
 * `laborRateForWorkOrder`). Un OT sans taux applicable est absent de la table.
 */
export async function laborRatesForWorkOrders(workOrderIds: readonly number[]): Promise<Map<number, number>> {
  const rates = new Map<number, number>();
  if (workOrderIds.length === 0) return rates;
  const res = await db.execute(sql`
    SELECT w.id AS work_order_id, r.hourly_rate_ht::float8 AS hourly_rate_ht
    FROM work_orders w
    JOIN LATERAL (
      SELECT hourly_rate_ht FROM workshop_labor_rates
      WHERE effective_from <= ${RATE_DATE_OF_WORK_ORDER}
      ORDER BY effective_from DESC
      LIMIT 1
    ) r ON true
    WHERE w.id IN (${sql.join(workOrderIds.map((id) => sql`${id}`), sql`, `)})`);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{
    work_order_id: number;
    hourly_rate_ht: number;
  }>;
  for (const row of rows) rates.set(Number(row.work_order_id), Number(row.hourly_rate_ht));
  return rates;
}

/** `true` si l'OT existe : distingue « OT inconnu » (404) de « aucun taux applicable » (null). */
export async function workOrderExists(workOrderId: number): Promise<boolean> {
  const res = await db.execute(sql`SELECT 1 FROM work_orders WHERE id = ${workOrderId} LIMIT 1`);
  const rows = Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

/** Ajoute un taux daté. Une seconde saisie à la même date d'effet est refusée (409), jamais écrasée. */
export async function createWorkshopLaborRate(userId: number, input: CreateWorkshopLaborRateRequest): Promise<WorkshopLaborRate> {
  try {
    const [row] = await db
      .insert(workshopLaborRates)
      .values({ effectiveFrom: input.effectiveFrom, hourlyRateHt: String(input.hourlyRateHt), createdBy: userId })
      .returning();
    return toRate(row);
  } catch (err) {
    const { code, constraint } = pgErrorOf(err);
    if (code === "23505" && (constraint === undefined || constraint === UNIQUE_DATE_CONSTRAINT)) {
      throw new AppError(409, "Un taux horaire existe déjà à cette date d'effet. Choisissez une autre date.", { cause: err });
    }
    if (code === "23514") {
      throw new AppError(400, "Le taux horaire ne peut pas être négatif.", { cause: err });
    }
    log.error({ err, userId, effectiveFrom: input.effectiveFrom }, "création du taux horaire impossible");
    throw err;
  }
}
