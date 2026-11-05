import { eq } from "drizzle-orm";
import { MISSION_BUDGET_READ_ROLES } from "@shared/constants/roles";
import type { MissionBudgetStatus } from "@shared/contracts/mission-budgets";
import { missionBudgets } from "@shared/schema";
import { db } from "../db";
import { isFeatureEnabled } from "../lib/feature-flags";

/**
 * Budget lu par la préparation au lancement d'une mission (L1g).
 *
 * Drapeau finance coupé : l'ancien budget de la fiche (`workflowData.budgetPlan`) fait foi,
 * comportement inchangé. Drapeau actif : le budget de mission (L1) le remplace, et seul un
 * budget approuvé ou décaissé compte. Un budget seulement demandé ne lance pas la mission :
 * l'approbation par la direction est la raison d'être du circuit.
 *
 * Correspondance des trois contrôles : carburant = montant carburant, FDR = FDR,
 * imprévus = frais annexes.
 */

export type LaunchBudgetPlan = {
  fuelBudget: number | null;
  roadExpensesBudget: number | null;
  contingencyBudget: number | null;
};

export type LaunchBudget = {
  plan: LaunchBudgetPlan;
  /** Explication d'un contrôle non passé, à la place de « non renseigné » ; null : ancien budget. */
  missingDetail: string | null;
};

const LAUNCHABLE: ReadonlySet<MissionBudgetStatus> = new Set(["approved", "disbursed"]);
const EMPTY: LaunchBudgetPlan = { fuelBudget: null, roadExpensesBudget: null, contingencyBudget: null };

type BudgetRow = { status: MissionBudgetStatus; fuelAmount: string; fdrAmount: string; extrasAmount: string };

/** Règle pure : budget de mission (ou son absence) → budget de lancement. */
export function launchBudgetOf(row: BudgetRow | undefined): LaunchBudget {
  if (!row) return { plan: EMPTY, missingDetail: "Aucun budget de mission. Créer et faire approuver le budget dans l'onglet Budget." };
  if (!LAUNCHABLE.has(row.status)) return { plan: EMPTY, missingDetail: "Budget de mission en attente d'approbation. Le faire approuver dans l'onglet Budget." };
  return {
    plan: { fuelBudget: Number(row.fuelAmount), roadExpensesBudget: Number(row.fdrAmount), contingencyBudget: Number(row.extrasAmount) },
    missingDetail: null,
  };
}

const BUDGET_CHECK_KEYS: ReadonlySet<string> = new Set(["budget_fuel", "budget_road_expenses", "budget_contingency"]);
export const APPROVED_BUDGET_DETAIL = "Budget approuvé.";
export const FUEL_SHORTFALL_DETAIL = "Solde carte carburant insuffisant pour le budget carburant approuvé.";

type ReadinessCheck = { key: string; passed: boolean; detail: string };
type ReadinessBody = {
  checks: ReadinessCheck[];
  blockingFailures: ReadinessCheck[];
  fuel: { requiredBudget: number | null; balanceUnavailable: boolean };
  budgets: Record<string, number | null>;
};
export type PresentLaunchReadiness = <T extends ReadinessBody>(body: T) => T;

const showAmounts: PresentLaunchReadiness = (body) => body;

/**
 * Check-list de lancement sans les montants du budget de mission, pour un rôle qui ne lit pas les budgets
 * (`MISSION_BUDGET_READ_ROLES`). Le verdict de chaque contrôle est conservé, seuls les montants disparaissent.
 */
export const hideLaunchBudgetAmounts: PresentLaunchReadiness = (body) => {
  const shortfall = Number(body.fuel.requiredBudget) > 0 && !body.fuel.balanceUnavailable;
  const hide = <C extends ReadinessCheck>(check: C): C => {
    if (check.passed && BUDGET_CHECK_KEYS.has(check.key)) return { ...check, detail: APPROVED_BUDGET_DETAIL };
    if (!check.passed && shortfall && check.key === "fuel_balance") return { ...check, detail: FUEL_SHORTFALL_DETAIL };
    return check;
  };
  return {
    ...body,
    checks: body.checks.map(hide),
    blockingFailures: body.blockingFailures.map(hide),
    fuel: { ...body.fuel, requiredBudget: null },
    budgets: Object.fromEntries(Object.keys(body.budgets).map((key) => [key, null])),
  };
};

export function canReadLaunchBudgetAmounts(role: string | null | undefined): boolean {
  return (MISSION_BUDGET_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * `present` (launch-readiness) et `fuelShortfallMotif` (PUT de statut) : drapeau coupé, inchangés (ancien
 * budget, visible comme avant) ; drapeau actif, montants retirés hors des rôles lecteurs du budget de mission.
 */
type FuelShortfallMotif = (balance: number, fuelBudget: number) => string;

const fuelShortfallWithAmounts: FuelShortfallMotif = (balance, fuelBudget) =>
  `Solde carte carburant insuffisant (${Math.round(balance)} FCFA < ${Math.round(fuelBudget)} FCFA).`;
const fuelShortfallWithoutAmounts: FuelShortfallMotif = () => FUEL_SHORTFALL_DETAIL;

export type ResolvedLaunchBudget = LaunchBudget & {
  present: PresentLaunchReadiness;
  /** Motif de refus du lancement (PUT de statut) quand le solde carte ne couvre pas le budget carburant. */
  fuelShortfallMotif: FuelShortfallMotif;
};

export async function resolveLaunchBudget(missionId: number, legacy: LaunchBudgetPlan, role?: string | null): Promise<ResolvedLaunchBudget> {
  if (!isFeatureEnabled("finance")) return { plan: legacy, missingDetail: null, present: showAmounts, fuelShortfallMotif: fuelShortfallWithAmounts };
  const [row] = await db
    .select({ status: missionBudgets.status, fuelAmount: missionBudgets.fuelAmount, fdrAmount: missionBudgets.fdrAmount, extrasAmount: missionBudgets.extrasAmount })
    .from(missionBudgets)
    .where(eq(missionBudgets.missionId, missionId));
  const reader = canReadLaunchBudgetAmounts(role);
  return {
    ...launchBudgetOf(row),
    present: reader ? showAmounts : hideLaunchBudgetAmounts,
    fuelShortfallMotif: reader ? fuelShortfallWithAmounts : fuelShortfallWithoutAmounts,
  };
}
