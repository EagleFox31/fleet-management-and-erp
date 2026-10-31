import { desc } from "drizzle-orm";
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
