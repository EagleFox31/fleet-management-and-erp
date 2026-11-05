import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { MISSION_BUDGET_READ_ROLES } from "@shared/constants/roles";
import {
  computeMissionBudget,
  isBudgetDateInWindow,
  MISSION_BUDGET_DATE_WINDOW_DAYS,
  MISSION_BUDGET_STATUSES,
  MISSION_STATUSES_WITHOUT_BUDGET,
  MISSION_BUDGET_EXPENSE_LINES,
  type CreateMissionBudgetExpenseRequest,
  type CreateMissionBudgetRequest,
  type MissionBudgetExpense,
  type MissionBudgetExpenseLine,
  type MissionBudgetExpenses,
  type DailyNeed,
  type MissionBudget,
  type MissionBudgetStatus,
  type MissionDestination,
  type UpdateMissionBudgetRequest,
} from "@shared/contracts/mission-budgets";
import {
  missionBudgetExpenses,
  missionBudgets,
  missionDestinations,
  missions,
  type MissionBudgetExpenseRow,
  type MissionBudgetRow,
} from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isUniqueViolation } from "../lib/pg-errors";
import { findFuelPriceAt, todayIsoDate } from "./fuel-price-service";
import {
  isMissionBudgetReversed,
  justifiedMissionBudgetExpenses,
  linkMissionBudgetDisbursement,
  reverseMissionBudgetDisbursements,
} from "./treasury-links";

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

/**
 * Portée explicite : sans elle, `broadcastUpdate` ne diffuse rien (fermé par défaut). De L1 à L1e,
 * l'événement partait sans portée et n'atteignait personne. Montants d'argent : lecteurs du budget seuls.
 */
function notify(budget: MissionBudget) {
  const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
  broadcast?.("mission_budget_updated", {
    id: budget.id,
    missionId: budget.missionId,
    status: budget.status,
    budgetDate: budget.budgetDate,
    scope: { type: "roles", roles: [...MISSION_BUDGET_READ_ROLES] },
  });
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

/**
 * Liste fermée : une destination inconnue ou retirée du barème est refusée (400). Lue dans la
 * transaction de la saisie, FOR SHARE : un retrait concurrent attend la fin de la saisie.
 */
async function activeDestination(ex: Executor, id: number) {
  const [row] = await ex
    .select()
    .from(missionDestinations)
    .where(and(eq(missionDestinations.id, id), eq(missionDestinations.active, true)))
    .for("share");
  if (!row) throw new AppError(400, "Destination inconnue ou retirée du barème.");
  return row;
}

export async function listMissionBudgets(filter: { date?: string; status?: MissionBudgetStatus; missionId?: number }): Promise<MissionBudget[]> {
  const where: SQL[] = [];
  if (filter.missionId !== undefined) where.push(eq(missionBudgets.missionId, filter.missionId));
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
      const destination = input.destinationId != null ? await activeDestination(tx, input.destinationId) : null;
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
    if (input.destinationId != null) await activeDestination(tx, input.destinationId);
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

/**
 * Changement de statut d'une mission, appelé dans sa transaction (PUT /api/missions/:id/status).
 * Seule l'annulation agit : budget non décaissé, aucun mouvement (il reste figé, cf. lockOpenMission) ;
 * budget décaissé, contre-passation du reliquat au journal (reverseMissionBudgetDisbursements).
 */
export async function onMissionStatusChange(tx: Executor, missionId: number, nextStatus: string, userId: number | null): Promise<void> {
  if (nextStatus !== "cancelled") return;
  const disbursed = await tx
    .select({ id: missionBudgets.id })
    .from(missionBudgets)
    .where(and(eq(missionBudgets.missionId, missionId), eq(missionBudgets.status, "disbursed")));
  const reversed = await reverseMissionBudgetDisbursements(tx as never, disbursed.map((b) => b.id), userId);
  if (reversed > 0) log.info({ missionId, budgetIds: disbursed.map((b) => b.id), reversed }, "budget de mission contre-passé (mission annulée)");
}

/** Montant décaissé sur une ligne : FDR + frais annexes, ou carburant. Plafond de ses dépenses (L1e). */
function disbursedOf(row: MissionBudgetRow, line: MissionBudgetExpenseLine): number {
  return line === "fdr" ? Number(row.fdrAmount) + Number(row.extrasAmount) : Number(row.fuelAmount);
}

function toMissionBudgetExpense(row: MissionBudgetExpenseRow): MissionBudgetExpense {
  return {
    id: row.id,
    budgetId: row.budgetId,
    line: row.line,
    amount: row.amount,
    label: row.label,
    expenseDate: row.expenseDate,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Budget dont on saisit ou retire une dépense (L1e), même ordre de verrous que les transitions :
 * mission FOR SHARE (lockOpenMission, 409 si terminée ou annulée), puis budget FOR UPDATE, tenu
 * pendant le contrôle de somme : deux saisies simultanées ne dépassent pas le décaissé.
 * Une annulation concurrente tient la ligne mission : elle attend la saisie, et sa contre-passation
 * compte la dépense ; ou elle passe avant, et la saisie est refusée.
 */
async function lockBudgetForExpenses(tx: Executor, budgetId: number): Promise<MissionBudgetRow> {
  const [target] = await tx.select({ missionId: missionBudgets.missionId }).from(missionBudgets).where(eq(missionBudgets.id, budgetId));
  if (!target) throw new AppError(404, "Budget de mission introuvable.");
  await lockOpenMission(tx, target.missionId);
  const [row] = await tx.select().from(missionBudgets).where(eq(missionBudgets.id, budgetId)).for("update");
  if (row.status !== "disbursed") throw new AppError(409, "Ce budget n'est pas décaissé : aucune dépense à justifier.");
  if (await isMissionBudgetReversed(tx as never, budgetId)) {
    throw new AppError(409, "Le reliquat de ce budget a été rendu au compte source : ses dépenses ne changent plus.");
  }
  return row;
}

const xaf = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} FCFA`;

/** Dépenses non supprimées d'un budget, et par ligne : décaissé, justifié, reste à justifier. */
export async function listMissionBudgetExpenses(budgetId: number): Promise<MissionBudgetExpenses> {
  const [budget] = await db.select().from(missionBudgets).where(eq(missionBudgets.id, budgetId));
  if (!budget) throw new AppError(404, "Budget de mission introuvable.");
  const rows = await db
    .select()
    .from(missionBudgetExpenses)
    .where(and(eq(missionBudgetExpenses.budgetId, budgetId), isNull(missionBudgetExpenses.deletedAt)))
    .orderBy(asc(missionBudgetExpenses.expenseDate), asc(missionBudgetExpenses.id));
  const justified = await justifiedMissionBudgetExpenses(db as never, [budgetId]);
  const lines = MISSION_BUDGET_EXPENSE_LINES.map((line) => {
    const disbursed = budget.status === "disbursed" ? disbursedOf(budget, line) : 0;
    const spent = justified.get(`${budgetId}:${line}`) ?? 0;
    return { line, disbursed, justified: spent, remaining: Math.round((disbursed - spent) * 100) / 100 };
  });
  return { budgetId, lines, expenses: rows.map(toMissionBudgetExpense) };
}

/**
 * Saisie d'une dépense justifiée sur un budget décaissé (L1e). Somme des dépenses non supprimées de
 * la ligne ≤ montant décaissé sur la ligne, sinon 409 (avance complémentaire : lot ultérieur).
 */
export async function createMissionBudgetExpense(
  budgetId: number,
  userId: number,
  input: CreateMissionBudgetExpenseRequest,
): Promise<MissionBudgetExpense> {
  const today = isoDateInZone(new Date());
  const expenseDate = input.expenseDate ?? today;
  if (expenseDate > today) throw new AppError(400, "La date de la dépense ne peut pas être dans le futur.");
  const { budget, row } = await db.transaction(async (tx) => {
    const budget = await lockBudgetForExpenses(tx, budgetId);
    // Une dépense justifie un décaissement : elle ne le précède pas (jour de Douala ; budget hérité sans date : pas de borne).
    if (budget.disbursedAt && expenseDate < isoDateInZone(budget.disbursedAt)) {
      throw new AppError(400, "La date de la dépense ne peut pas précéder le décaissement du budget.");
    }
    const spent = (await justifiedMissionBudgetExpenses(tx as never, [budgetId])).get(`${budgetId}:${input.line}`) ?? 0;
    const remaining = Math.round((disbursedOf(budget, input.line) - spent) * 100) / 100;
    if (input.amount > remaining) {
      throw new AppError(409, `Dépense au-delà du montant décaissé sur cette ligne : il reste ${xaf(Math.max(0, remaining))} à justifier.`);
    }
    const now = new Date();
    const [row] = await tx
      .insert(missionBudgetExpenses)
      .values({ budgetId, line: input.line, amount: input.amount, label: input.label, expenseDate, createdBy: userId, updatedBy: userId, createdAt: now, updatedAt: now })
      .returning();
    return { budget, row };
  });
  log.info({ budgetId, expenseId: row.id, userId, line: row.line, amount: row.amount }, "budget de mission : dépense justifiée saisie");
  notify(toMissionBudget(budget));
  return toMissionBudgetExpense(row);
}

/**
 * Suppression douce d'une dépense (L1e) : deleted_at et deleted_by, jamais d'effacement. Rejouable :
 * une dépense déjà supprimée ne change plus. Mêmes refus que la saisie (mission close, reliquat rendu).
 */
export async function deleteMissionBudgetExpense(budgetId: number, expenseId: number, userId: number): Promise<void> {
  const { budget, changed } = await db.transaction(async (tx) => {
    const budget = await lockBudgetForExpenses(tx, budgetId);
    const [expense] = await tx
      .select({ id: missionBudgetExpenses.id, deletedAt: missionBudgetExpenses.deletedAt })
      .from(missionBudgetExpenses)
      .where(and(eq(missionBudgetExpenses.id, expenseId), eq(missionBudgetExpenses.budgetId, budgetId)));
    if (!expense) throw new AppError(404, "Dépense introuvable sur ce budget.");
    if (expense.deletedAt) return { budget, changed: false };
    const now = new Date();
    const updated = await tx
      .update(missionBudgetExpenses)
      .set({ deletedAt: now, deletedBy: userId, updatedBy: userId, updatedAt: now })
      .where(and(eq(missionBudgetExpenses.id, expenseId), isNull(missionBudgetExpenses.deletedAt)))
      .returning({ id: missionBudgetExpenses.id });
    return { budget, changed: updated.length > 0 };
  });
  if (!changed) return;
  log.info({ budgetId, expenseId, userId }, "budget de mission : dépense justifiée supprimée");
  notify(toMissionBudget(budget));
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
