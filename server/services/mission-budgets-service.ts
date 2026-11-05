import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  computeMissionBudget,
  isBudgetDateInWindow,
  MISSION_BUDGET_DATE_WINDOW_DAYS,
  MISSION_BUDGET_STATUSES,
  type CreateMissionBudgetRequest,
  type DailyNeed,
  type MissionBudget,
  type MissionBudgetStatus,
  type UpdateMissionBudgetRequest,
} from "@shared/contracts/mission-budgets";
import { missionBudgets, missions, type MissionBudgetRow } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isUniqueViolation } from "../lib/pg-errors";
import { findFuelPriceAt, todayIsoDate } from "./fuel-price-service";

const log = moduleLogger("mission-budgets");

const money = (value: number) => value.toFixed(2);

function toMissionBudget(row: MissionBudgetRow): MissionBudget {
  return {
    id: row.id,
    missionId: row.missionId,
    budgetDate: row.budgetDate,
    fuelLiters: Number(row.fuelLiters),
    fuelUnitPrice: Number(row.fuelUnitPrice),
    fuelAmount: Number(row.fuelAmount),
    fdrAmount: Number(row.fdrAmount),
    extrasAmount: Number(row.extrasAmount),
    totalAmount: Number(row.totalAmount),
    status: row.status,
    notes: row.notes ?? null,
    treasuryEntryId: row.treasuryEntryId ?? null,
    approvedBy: row.approvedBy ?? null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    disbursedBy: row.disbursedBy ?? null,
    disbursedAt: row.disbursedAt ? row.disbursedAt.toISOString() : null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Prix du litre à `date` pour un budget : jamais de prix par défaut figé en silence.
 * Aucun prix posé à cette date ou avant : 409. Une erreur de lecture remonte (500 + référence).
 */
export async function resolveBudgetFuelPrice(date: string): Promise<number> {
  const price = await findFuelPriceAt(date);
  if (price === null) throw new AppError(409, "Aucun prix carburant pour cette date : faites poser le prix avant de saisir le budget.");
  return price;
}

function assertBudgetDate(budgetDate: string) {
  if (!isBudgetDateInWindow(budgetDate, todayIsoDate())) {
    throw new AppError(400, `La date du budget doit être à moins de ${MISSION_BUDGET_DATE_WINDOW_DAYS} jours d'aujourd'hui.`);
  }
}

/** Colonnes de montant, prix du jour de `budgetDate` figé au moment de l'écriture. */
async function amountColumns(input: { budgetDate: string; fuelLiters: number; fdrAmount: number; extrasAmount: number }) {
  assertBudgetDate(input.budgetDate);
  const fuelUnitPrice = await resolveBudgetFuelPrice(input.budgetDate);
  const { fuelAmount, totalAmount } = computeMissionBudget({ ...input, fuelUnitPrice });
  return {
    budgetDate: input.budgetDate,
    fuelLiters: money(input.fuelLiters),
    fuelUnitPrice: money(fuelUnitPrice),
    fuelAmount: money(fuelAmount),
    fdrAmount: money(input.fdrAmount),
    extrasAmount: money(input.extrasAmount),
    totalAmount: money(totalAmount),
  };
}

function notify(budget: MissionBudget) {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  broadcast?.("mission_budget_updated", { id: budget.id, missionId: budget.missionId, status: budget.status, budgetDate: budget.budgetDate });
}

export async function listMissionBudgets(filter: { date?: string; status?: MissionBudgetStatus }): Promise<MissionBudget[]> {
  const where: SQL[] = [];
  if (filter.date) where.push(eq(missionBudgets.budgetDate, filter.date));
  if (filter.status) where.push(eq(missionBudgets.status, filter.status));
  const rows = await db
    .select()
    .from(missionBudgets)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(missionBudgets.budgetDate), asc(missionBudgets.id));
  return rows.map(toMissionBudget);
}

export async function getMissionBudget(id: number): Promise<MissionBudget> {
  const [row] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, id));
  if (!row) throw new AppError(404, "Budget de mission introuvable.");
  return toMissionBudget(row);
}

export async function createMissionBudget(userId: number, input: CreateMissionBudgetRequest): Promise<MissionBudget> {
  const [mission] = await db.select({ id: missions.id }).from(missions).where(eq(missions.id, input.missionId));
  if (!mission) throw new AppError(404, "Mission introuvable.");
  try {
    const [row] = await db
      .insert(missionBudgets)
      .values({
        missionId: input.missionId,
        ...(await amountColumns(input)),
        notes: input.notes ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const budget = toMissionBudget(row);
    log.info({ budgetId: budget.id, missionId: budget.missionId, userId }, "budget de mission saisi");
    notify(budget);
    return budget;
  } catch (err) {
    // Unicité mission_id : la contrainte tranche aussi deux saisies simultanées.
    if (isUniqueViolation(err)) throw new AppError(409, "Cette mission a déjà un budget.", { cause: err });
    throw err;
  }
}

/** Correction d'un budget encore demandé ; montants recalculés au prix du jour de la date retenue. */
export async function updateMissionBudget(id: number, userId: number, input: UpdateMissionBudgetRequest): Promise<MissionBudget> {
  const budget = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(missionBudgets).where(eq(missionBudgets.id, id)).for("update");
    if (!current) throw new AppError(404, "Budget de mission introuvable.");
    if (current.status !== "requested") throw new AppError(409, "Ce budget n'est plus modifiable : il a déjà été approuvé.");
    const merged = {
      budgetDate: input.budgetDate ?? current.budgetDate,
      fuelLiters: input.fuelLiters ?? Number(current.fuelLiters),
      fdrAmount: input.fdrAmount ?? Number(current.fdrAmount),
      extrasAmount: input.extrasAmount ?? Number(current.extrasAmount),
    };
    const [row] = await tx
      .update(missionBudgets)
      .set({
        ...(await amountColumns(merged)),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(missionBudgets.id, id))
      .returning();
    return toMissionBudget(row);
  });
  notify(budget);
  return budget;
}

const TRANSITIONS = {
  approve: { from: "requested", to: "approved", conflict: "Ce budget n'est pas en attente d'approbation." },
  disburse: { from: "approved", to: "disbursed", conflict: "Ce budget doit être approuvé avant d'être décaissé." },
} as const;

/** `updatedAt` lu par le client (ISO, milliseconde) comparé à la colonne tronquée à la milliseconde. */
const sameVersion = (expectedUpdatedAt: string) =>
  sql`date_trunc('milliseconds', ${missionBudgets.updatedAt}) = ${new Date(expectedUpdatedAt).toISOString().replace("T", " ").replace("Z", "")}::timestamp`;

/**
 * Transition par UPDATE conditionnel sur le statut attendu ET la version lue (`expectedUpdatedAt`) :
 * un rejeu, deux clics simultanés ou un budget corrigé entre la lecture et la validation ne
 * trouvent plus la ligne et répondent 409, sans écriture.
 * `disbursed` est un marquage tant que le journal de trésorerie (T1) n'est pas branché.
 */
export async function transitionMissionBudget(
  id: number,
  userId: number,
  action: keyof typeof TRANSITIONS,
  expectedUpdatedAt: string,
): Promise<MissionBudget> {
  const t = TRANSITIONS[action];
  const now = new Date();
  const stamp = action === "approve" ? { approvedBy: userId, approvedAt: now } : { disbursedBy: userId, disbursedAt: now };
  const [row] = await db
    .update(missionBudgets)
    .set({ status: t.to, ...stamp, updatedBy: userId, updatedAt: now })
    .where(and(eq(missionBudgets.id, id), eq(missionBudgets.status, t.from), sameVersion(expectedUpdatedAt)))
    .returning();
  if (!row) {
    const current = await getMissionBudget(id); // 404 si le budget n'existe pas
    if (current.status !== t.from) throw new AppError(409, t.conflict);
    throw new AppError(409, "Ce budget a changé depuis votre lecture : rechargez-le avant de valider.");
  }
  const budget = toMissionBudget(row);
  log.info({ budgetId: id, userId, status: budget.status }, "budget de mission : transition");
  notify(budget);
  return budget;
}

/** Besoin du jour : somme en base des budgets de la date, au total et par statut. */
export async function dailyNeed(date: string): Promise<DailyNeed> {
  const rows = await db
    .select({
      status: missionBudgets.status,
      count: sql<number>`count(*)::int`,
      fuelAmount: sql<string>`coalesce(sum(${missionBudgets.fuelAmount}), 0)`,
      fdrAmount: sql<string>`coalesce(sum(${missionBudgets.fdrAmount}), 0)`,
      extrasAmount: sql<string>`coalesce(sum(${missionBudgets.extrasAmount}), 0)`,
      totalAmount: sql<string>`coalesce(sum(${missionBudgets.totalAmount}), 0)`,
    })
    .from(missionBudgets)
    .where(eq(missionBudgets.budgetDate, date))
    .groupBy(missionBudgets.status);

  const zero = () => ({ count: 0, fuelAmount: 0, fdrAmount: 0, extrasAmount: 0, totalAmount: 0 });
  const total = zero();
  const byStatus = Object.fromEntries(MISSION_BUDGET_STATUSES.map((s) => [s, zero()])) as DailyNeed["byStatus"];
  // Sommes en centimes entiers : numeric(15,2) relu sans dérive flottante.
  const cents = (v: string) => Math.round(Number(v) * 100);
  for (const r of rows) {
    const t = {
      count: Number(r.count),
      fuelAmount: cents(r.fuelAmount) / 100,
      fdrAmount: cents(r.fdrAmount) / 100,
      extrasAmount: cents(r.extrasAmount) / 100,
      totalAmount: cents(r.totalAmount) / 100,
    };
    byStatus[r.status] = t;
    total.count += t.count;
    for (const k of ["fuelAmount", "fdrAmount", "extrasAmount", "totalAmount"] as const) {
      total[k] = (Math.round(total[k] * 100) + Math.round(t[k] * 100)) / 100;
    }
  }
  return { date, ...total, byStatus };
}
