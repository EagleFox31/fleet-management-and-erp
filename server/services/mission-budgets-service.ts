import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  computeMissionBudget,
  isBudgetDateInWindow,
  MISSION_BUDGET_DATE_WINDOW_DAYS,
  MISSION_BUDGET_STATUSES,
  MISSION_STATUSES_WITHOUT_BUDGET,
  type CreateMissionBudgetRequest,
  type DailyNeed,
  type MissionBudget,
  type MissionBudgetStatus,
  type MissionDestination,
  type UpdateMissionBudgetRequest,
} from "@shared/contracts/mission-budgets";
import { missionBudgets, missionDestinations, missions, type MissionBudgetRow } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isUniqueViolation } from "../lib/pg-errors";
import { findFuelPriceAt, todayIsoDate } from "./fuel-price-service";
import { linkMissionBudgetDisbursement } from "./treasury-links";

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
    destinationId: row.destinationId ?? null,
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

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const CLOSED_MISSION = "Cette mission est terminée ou annulée : son budget ne peut plus être saisi, corrigé, approuvé ni décaissé.";

/**
 * Mission ouverte, verrouillée en partage jusqu'à la fin de la transaction : une annulation ou une
 * clôture concurrente attend l'écriture du budget, ou la précède et la fait refuser (409).
 */
async function lockOpenMission(tx: Executor, missionId: number) {
  const [mission] = await tx
    .select({ status: missions.status })
    .from(missions)
    .where(eq(missions.id, missionId))
    .for("share");
  if (!mission) throw new AppError(404, "Mission introuvable.");
  if ((MISSION_STATUSES_WITHOUT_BUDGET as readonly string[]).includes(mission.status)) throw new AppError(409, CLOSED_MISSION);
}

function notify(budget: MissionBudget) {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  broadcast?.("mission_budget_updated", { id: budget.id, missionId: budget.missionId, status: budget.status, budgetDate: budget.budgetDate });
}

/** Barème FDR (L1b) : destinations actives, par libellé. */
export async function listMissionDestinations(): Promise<MissionDestination[]> {
  const rows = await db
    .select()
    .from(missionDestinations)
    .where(eq(missionDestinations.active, true))
    .orderBy(asc(missionDestinations.label));
  return rows.map((r) => ({ id: r.id, code: r.code, label: r.label, fuelLiters: Number(r.fuelLiters), fdrAmount: Number(r.fdrAmount) }));
}

/** Liste fermée : une destination inconnue ou retirée du barème est refusée (400). */
async function activeDestination(id: number) {
  const [row] = await db
    .select()
    .from(missionDestinations)
    .where(and(eq(missionDestinations.id, id), eq(missionDestinations.active, true)));
  if (!row) throw new AppError(400, "Destination inconnue ou retirée du barème.");
  return row;
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
  try {
    const row = await db.transaction(async (tx) => {
      await lockOpenMission(tx, input.missionId);
      // Barème : complète litres et FDR absents du corps ; une valeur fournie l'emporte.
      const destination = input.destinationId != null ? await activeDestination(input.destinationId) : null;
      const fuelLiters = input.fuelLiters ?? (destination ? Number(destination.fuelLiters) : undefined);
      const fdrAmount = input.fdrAmount ?? (destination ? Number(destination.fdrAmount) : undefined);
      // Garanti par le contrat (litres et FDR requis sans destination) : garde de type seulement.
      if (fuelLiters === undefined || fdrAmount === undefined) throw new AppError(400, "Litres et FDR requis sans destination du barème.");
      const [inserted] = await tx
        .insert(missionBudgets)
        .values({
          missionId: input.missionId,
          destinationId: destination?.id ?? null,
          ...(await amountColumns({ budgetDate: input.budgetDate, fuelLiters, fdrAmount, extrasAmount: input.extrasAmount })),
          notes: input.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      return inserted;
    });
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

/**
 * Correction d'un budget encore demandé. Seul un changement de date ou de montant recalcule et re-fige
 * le prix du jour ; des notes seules le laissent tel quel. Aucun changement : aucune écriture.
 */
export async function updateMissionBudget(id: number, userId: number, input: UpdateMissionBudgetRequest): Promise<MissionBudget> {
  const result = await db.transaction(async (tx) => {
    // Même ordre de verrous que les transitions (mission, puis budget) : pas d'interblocage entre elles.
    const [target] = await tx.select({ missionId: missionBudgets.missionId }).from(missionBudgets).where(eq(missionBudgets.id, id));
    if (!target) throw new AppError(404, "Budget de mission introuvable.");
    await lockOpenMission(tx, target.missionId);
    const [current] = await tx.select().from(missionBudgets).where(eq(missionBudgets.id, id)).for("update");
    if (current.status !== "requested") throw new AppError(409, "Ce budget n'est plus modifiable : il a déjà été approuvé.");
    if (input.destinationId != null) await activeDestination(input.destinationId);
    const merged = {
      budgetDate: input.budgetDate ?? current.budgetDate,
      fuelLiters: input.fuelLiters ?? Number(current.fuelLiters),
      fdrAmount: input.fdrAmount ?? Number(current.fdrAmount),
      extrasAmount: input.extrasAmount ?? Number(current.extrasAmount),
    };
    // Comparaison au centime, sur la forme stockée (numeric relu en texte).
    const amountsChanged =
      merged.budgetDate !== current.budgetDate ||
      money(merged.fuelLiters) !== money(Number(current.fuelLiters)) ||
      money(merged.fdrAmount) !== money(Number(current.fdrAmount)) ||
      money(merged.extrasAmount) !== money(Number(current.extrasAmount));
    const notes = input.notes === undefined ? (current.notes ?? null) : (input.notes ?? null);
    const notesChanged = notes !== (current.notes ?? null);
    const destinationChanged =
      input.destinationId !== undefined && (input.destinationId ?? null) !== (current.destinationId ?? null);
    if (!amountsChanged && !notesChanged && !destinationChanged) return { budget: toMissionBudget(current), written: false, amountsChanged };
    const [row] = await tx
      .update(missionBudgets)
      .set({
        ...(amountsChanged ? await amountColumns(merged) : {}),
        ...(notesChanged ? { notes } : {}),
        ...(destinationChanged ? { destinationId: input.destinationId ?? null } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(missionBudgets.id, id))
      .returning();
    return { budget: toMissionBudget(row), written: true, amountsChanged };
  });
  if (result.written) {
    log.info({ budgetId: id, userId, amountsChanged: result.amountsChanged }, "budget de mission corrigé");
    notify(result.budget);
  }
  return result.budget;
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
 * `disbursed` avec un compte de trésorerie écrit au journal dans la même transaction (L1c) :
 * si l'écriture échoue, le budget reste approuvé. Sans compte, c'est un marquage.
 */
export async function transitionMissionBudget(
  id: number,
  userId: number,
  action: keyof typeof TRANSITIONS,
  expectedUpdatedAt: string,
  treasuryAccountId?: number | null,
): Promise<MissionBudget> {
  const t = TRANSITIONS[action];
  const now = new Date();
  const stamp = action === "approve" ? { approvedBy: userId, approvedAt: now } : { disbursedBy: userId, disbursedAt: now };
  const row = await db.transaction(async (tx) => {
    // mission_id ne change jamais : lu sans verrou, la mission est verrouillée avant l'UPDATE conditionnel.
    const [target] = await tx.select({ missionId: missionBudgets.missionId }).from(missionBudgets).where(eq(missionBudgets.id, id));
    if (!target) throw new AppError(404, "Budget de mission introuvable.");
    await lockOpenMission(tx, target.missionId);
    const [updated] = await tx
      .update(missionBudgets)
      .set({ status: t.to, ...stamp, updatedBy: userId, updatedAt: now })
      .where(and(eq(missionBudgets.id, id), eq(missionBudgets.status, t.from), sameVersion(expectedUpdatedAt)))
      .returning();
    if (updated) {
      if (action !== "disburse") return updated;
      const entryId = await linkMissionBudgetDisbursement(tx, updated, treasuryAccountId, userId);
      if (entryId === null) return updated;
      const [linked] = await tx.update(missionBudgets).set({ treasuryEntryId: entryId }).where(eq(missionBudgets.id, id)).returning();
      return linked;
    }
    const [current] = await tx.select({ status: missionBudgets.status }).from(missionBudgets).where(eq(missionBudgets.id, id));
    if (current.status !== t.from) throw new AppError(409, t.conflict);
    throw new AppError(409, "Ce budget a changé depuis votre lecture : rechargez-le avant de valider.");
  });
  const budget = toMissionBudget(row);
  log.info({ budgetId: id, userId, status: budget.status, treasuryEntryId: budget.treasuryEntryId }, "budget de mission : transition");
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
