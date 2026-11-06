import { MISSION_BUDGET_READ_ROLES } from "@shared/constants/roles";

/**
 * Montants du budget d'une mission (Q19) : lisibles par `MISSION_BUDGET_READ_ROLES` seulement. Technicien,
 * chauffeur et client ne les voient jamais, drapeau `finance` actif ou coupé, même quand la route renvoie la
 * ligne entière de `missions`.
 *
 * Champs concernés :
 * - ligne mission : `estimatedFuelCost` et `workflowData.budgetPlan` (ancien budget de la fiche) ;
 * - totaux carburant d'une mission : `estimatedBudget` et `budgetDelta` ;
 * - statistiques d'opérations (`/api/operations/stats/*`, `missions/by-client`) : `totalRevenue`, somme
 *   d'`estimatedFuelCost`, et ce qui s'en déduit (`margin`, `marginPercentage`). Une seule mission dans le
 *   groupe donnerait son montant exact ; les compteurs restent.
 *
 * Même forme que `mission-price-scope` : la clé reste présente et vaut `null`. Un lecteur absent est traité
 * comme non autorisé : échec fermé.
 */
export type MissionBudgetReader = { role?: string | null } | null | undefined;

export function canReadMissionBudget(reader: MissionBudgetReader): boolean {
  return (MISSION_BUDGET_READ_ROLES as readonly string[]).includes(String(reader?.role ?? ""));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

type Mode = "null" | "omit";

const REVENUE_KEYS = ["totalRevenue", "margin", "marginPercentage"] as const;

function walk(value: unknown, mode: Mode): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, mode));
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = walk(child, mode);
  if ("estimatedFuelCost" in next) {
    if (mode === "omit") delete next.estimatedFuelCost;
    else next.estimatedFuelCost = null;
  }
  if (isPlainObject(next.workflowData) && "budgetPlan" in next.workflowData) {
    const { budgetPlan: _budgetPlan, ...rest } = next.workflowData;
    next.workflowData = mode === "omit" ? rest : { ...rest, budgetPlan: null };
  }
  if ("estimatedBudget" in next && "budgetDelta" in next) {
    if (mode === "omit") {
      delete next.estimatedBudget;
      delete next.budgetDelta;
    } else {
      next.estimatedBudget = null;
      next.budgetDelta = null;
    }
  }
  if ("totalRevenue" in next) {
    for (const key of REVENUE_KEYS) {
      if (!(key in next)) continue;
      if (mode === "omit") delete next[key];
      else next[key] = null;
    }
  }
  return next;
}

/**
 * Tableaux et objets imbriqués (liste, détail, affectations, totaux carburant) : les montants du budget sont
 * retirés à toute profondeur. L'entrée n'est jamais modifiée ; dates et instances non simples restent intactes.
 */
export function redactMissionBudget<T>(reader: MissionBudgetReader, value: T): T {
  if (canReadMissionBudget(reader)) return value;
  return walk(value, "null") as T;
}

/**
 * Trame temps réel diffusée à tout le personnel : les montants du budget sont **retirés** (clés absentes), pas
 * mis à `null`. Le client fusionne la trame dans son cache ; une clé absente y laisse la valeur déjà lue par un
 * rôle lecteur, que la relecture de `/api/missions/:id` met ensuite à jour.
 */
export function omitMissionBudget<T>(value: T): T {
  return walk(value, "omit") as T;
}
