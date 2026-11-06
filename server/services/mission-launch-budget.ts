import { eq } from "drizzle-orm";
import { TREASURY_FUEL_CARD_READ_ROLES } from "@shared/constants/roles";
import type { MissionBudgetStatus } from "@shared/contracts/mission-budgets";
import { missionBudgets } from "@shared/schema";
import { db } from "../db";
import { isFeatureEnabled } from "../lib/feature-flags";
import { canReadMissionBudget } from "../lib/mission-budget-scope";

/**
 * Budget lu par la préparation au lancement d'une mission (L1g).
 *
 * Drapeau finance coupé : l'ancien budget de la fiche (`workflowData.budgetPlan`) fait foi
 * pour les contrôles. Drapeau actif : le budget de mission (L1) le remplace, et seul un
 * budget approuvé ou décaissé compte. Un budget seulement demandé ne lance pas la mission :
 * l'approbation par la direction est la raison d'être du circuit.
 *
 * Correspondance des trois contrôles : carburant = montant carburant, FDR = FDR,
 * imprévus = frais annexes.
 *
 * Montants (budget, solde carte) : retirés hors des rôles qui les lisent, quel que soit le drapeau (Q19).
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
/** Drapeau coupé : l'ancien budget de la fiche n'est pas « approuvé », il est seulement renseigné. */
export const LEGACY_BUDGET_DETAIL = "Budget renseigné.";
export const LEGACY_FUEL_SHORTFALL_DETAIL = "Solde carte carburant insuffisant pour le budget carburant prévu.";
/** Solde de la carte carburant couvrant le budget, pour qui ne lit pas ce solde. */
export const FUEL_BALANCE_OK_DETAIL = "Solde suffisant.";

type ReadinessCheck = { key: string; passed: boolean; detail: string };
type ReadinessBody = {
  checks: ReadinessCheck[];
  blockingFailures: ReadinessCheck[];
  fuel: { requiredBudget: number | null; balance?: number | null; balanceUnavailable: boolean };
  budgets: Record<string, number | null>;
  budgetSuggestion?: unknown;
};
export type PresentLaunchReadiness = <T extends ReadinessBody>(body: T) => T;

type BudgetWording = { passed: string; shortfall: string };
const MISSION_BUDGET_WORDING: BudgetWording = { passed: APPROVED_BUDGET_DETAIL, shortfall: FUEL_SHORTFALL_DETAIL };
const LEGACY_BUDGET_WORDING: BudgetWording = { passed: LEGACY_BUDGET_DETAIL, shortfall: LEGACY_FUEL_SHORTFALL_DETAIL };

const showAmounts: PresentLaunchReadiness = (body) => body;

/**
 * Check-list de lancement selon ce que le lecteur a le droit de lire (Q19) :
 * - `budget` faux (hors `MISSION_BUDGET_READ_ROLES`) : montants du budget et suggestion de budget retirés ;
 * - `balance` faux (hors `TREASURY_FUEL_CARD_READ_ROLES`) : solde de la carte carburant retiré.
 * Le verdict de chaque contrôle est conservé, seuls les montants disparaissent. Les textes de remplacement
 * disent « approuvé » (budget de mission) ou « renseigné / prévu » (ancien budget, drapeau coupé).
 */
export function launchReadinessPresenter(rights: { budget: boolean; balance: boolean }, wording: BudgetWording = MISSION_BUDGET_WORDING): PresentLaunchReadiness {
  if (rights.budget && rights.balance) return showAmounts;
  return (body) => {
    const shortfall = Number(body.fuel.requiredBudget) > 0 && !body.fuel.balanceUnavailable;
    const hide = <C extends ReadinessCheck>(check: C): C => {
      if (!rights.budget && check.passed && BUDGET_CHECK_KEYS.has(check.key)) return { ...check, detail: wording.passed };
      if (check.key === "fuel_balance") {
        if (check.passed && !rights.balance) return { ...check, detail: FUEL_BALANCE_OK_DETAIL };
        // Le motif chiffré cite le solde et le budget : l'un des deux interdit suffit à le taire.
        if (!check.passed && shortfall) return { ...check, detail: wording.shortfall };
      }
      return check;
    };
    return {
      ...body,
      checks: body.checks.map(hide),
      blockingFailures: body.blockingFailures.map(hide),
      fuel: {
        ...body.fuel,
        ...(rights.budget ? {} : { requiredBudget: null }),
        ...(rights.balance ? {} : { balance: null }),
      },
      ...(rights.budget
        ? {}
        : {
            budgets: Object.fromEntries(Object.keys(body.budgets).map((key) => [key, null])),
            ...("budgetSuggestion" in body ? { budgetSuggestion: null } : {}),
          }),
    };
  };
}

/** Lecteur qui ne lit ni le budget ni le solde carte (technicien, chauffeur) : budget de mission. */
export const hideLaunchBudgetAmounts = launchReadinessPresenter({ budget: false, balance: false });

export function canReadLaunchBudgetAmounts(role: string | null | undefined): boolean {
  return canReadMissionBudget({ role });
}

export function canReadFuelCardBalance(role: string | null | undefined): boolean {
  return (TREASURY_FUEL_CARD_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * `present` (launch-readiness) et `fuelShortfallMotif` (PUT de statut) : montants retirés selon les droits du
 * lecteur, drapeau actif comme coupé (Q19). Lecteurs du budget et du solde : inchangés.
 */
type FuelShortfallMotif = (balance: number, fuelBudget: number) => string;

const fuelShortfallWithAmounts: FuelShortfallMotif = (balance, fuelBudget) =>
  `Solde carte carburant insuffisant (${Math.round(balance)} FCFA < ${Math.round(fuelBudget)} FCFA).`;

export type ResolvedLaunchBudget = LaunchBudget & {
  present: PresentLaunchReadiness;
  /** Motif de refus du lancement (PUT de statut) quand le solde carte ne couvre pas le budget carburant. */
  fuelShortfallMotif: FuelShortfallMotif;
};

function presentationFor(role: string | null | undefined, wording: BudgetWording): Pick<ResolvedLaunchBudget, "present" | "fuelShortfallMotif"> {
  const rights = { budget: canReadLaunchBudgetAmounts(role), balance: canReadFuelCardBalance(role) };
  return {
    present: launchReadinessPresenter(rights, wording),
    fuelShortfallMotif: rights.budget && rights.balance ? fuelShortfallWithAmounts : () => wording.shortfall,
  };
}

export async function resolveLaunchBudget(missionId: number, legacy: LaunchBudgetPlan, role?: string | null): Promise<ResolvedLaunchBudget> {
  if (!isFeatureEnabled("finance")) return { plan: legacy, missingDetail: null, ...presentationFor(role, LEGACY_BUDGET_WORDING) };
  const [row] = await db
    .select({ status: missionBudgets.status, fuelAmount: missionBudgets.fuelAmount, fdrAmount: missionBudgets.fdrAmount, extrasAmount: missionBudgets.extrasAmount })
    .from(missionBudgets)
    .where(eq(missionBudgets.missionId, missionId));
  return { ...launchBudgetOf(row), ...presentationFor(role, MISSION_BUDGET_WORDING) };
}
