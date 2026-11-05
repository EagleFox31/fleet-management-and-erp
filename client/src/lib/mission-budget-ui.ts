/**
 * Budget de mission (L1f) : ce qu'un rôle peut faire sur le budget d'une mission, selon son statut
 * et celui de la mission. Les rôles viennent des constantes partagées, comme les gardes serveur :
 * une action masquée ici est aussi refusée par l'API (403/409), jamais l'inverse.
 */
import {
  MISSION_BUDGET_APPROVE_ROLES,
  MISSION_BUDGET_DISBURSE_ROLES,
  MISSION_BUDGET_READ_ROLES,
  MISSION_BUDGET_WRITE_ROLES,
} from "@shared/constants/roles";
import {
  MISSION_STATUSES_WITHOUT_BUDGET,
  type MissionBudget,
  type MissionBudgetExpenses,
  type MissionBudgetExpenseLine,
} from "@shared/contracts/mission-budgets";

const has = (roles: readonly string[], role: string | null | undefined) => !!role && roles.includes(role);

export const canReadMissionBudget = (role: string | null | undefined) => has(MISSION_BUDGET_READ_ROLES, role);

export type MissionBudgetActions = {
  create: boolean;
  edit: boolean;
  approve: boolean;
  disburse: boolean;
  /** Saisir ou supprimer une dépense justifiée. */
  expenses: boolean;
};

/**
 * Mission terminée ou annulée : plus aucune action (le serveur répond 409).
 * Sans budget : seule la saisie. Ensuite, chaque statut n'ouvre que son étape suivante.
 */
export function missionBudgetActions(
  role: string | null | undefined,
  budget: Pick<MissionBudget, "status"> | null,
  missionStatus: string | null | undefined,
): MissionBudgetActions {
  const open = !(MISSION_STATUSES_WITHOUT_BUDGET as readonly string[]).includes(String(missionStatus ?? ""));
  const write = open && has(MISSION_BUDGET_WRITE_ROLES, role);
  const status = budget?.status ?? null;
  return {
    create: write && status === null,
    edit: write && status === "requested",
    approve: open && has(MISSION_BUDGET_APPROVE_ROLES, role) && status === "requested",
    disburse: open && has(MISSION_BUDGET_DISBURSE_ROLES, role) && status === "approved",
    expenses: open && has(MISSION_BUDGET_DISBURSE_ROLES, role) && status === "disbursed",
  };
}

/** Reste à justifier d'une ligne, 0 si la ligne est absente (rien décaissé dessus). */
export function remainingOf(expenses: MissionBudgetExpenses | undefined, line: MissionBudgetExpenseLine): number {
  return expenses?.lines.find((l) => l.line === line)?.remaining ?? 0;
}

/** Montant en francs CFA, sans décimales (XAF n'a pas de subdivision en usage). */
export function formatXaf(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(amount))} FCFA`;
}
