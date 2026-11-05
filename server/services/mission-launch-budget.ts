import { eq } from "drizzle-orm";
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

export async function resolveLaunchBudget(missionId: number, legacy: LaunchBudgetPlan): Promise<LaunchBudget> {
  if (!isFeatureEnabled("finance")) return { plan: legacy, missingDetail: null };
  const [row] = await db
    .select({ status: missionBudgets.status, fuelAmount: missionBudgets.fuelAmount, fdrAmount: missionBudgets.fdrAmount, extrasAmount: missionBudgets.extrasAmount })
    .from(missionBudgets)
    .where(eq(missionBudgets.missionId, missionId));
  return launchBudgetOf(row);
}
