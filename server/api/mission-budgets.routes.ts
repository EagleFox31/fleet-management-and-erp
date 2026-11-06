import { Router, type RequestHandler } from "express";
import {
  createMissionBudgetExpenseRequestSchema,
  createMissionBudgetRequestSchema,
  dailyNeedQuerySchema,
  dailyNeedResponseSchema,
  missionBudgetSchema,
  missionBudgetDisburseRequestSchema,
  missionBudgetExpenseSchema,
  missionBudgetExpensesResponseSchema,
  missionBudgetTransitionRequestSchema,
  missionBudgetsQuerySchema,
  missionBudgetsResponseSchema,
  missionDestinationsResponseSchema,
  updateMissionBudgetRequestSchema,
} from "@shared/contracts/mission-budgets";
import {
  MISSION_BUDGET_APPROVE_ROLES,
  MISSION_BUDGET_DISBURSE_ROLES,
  MISSION_BUDGET_READ_ROLES,
  MISSION_BUDGET_SETTLE_ROLES,
  MISSION_BUDGET_WRITE_ROLES,
} from "@shared/constants/roles";
import { requireFeature } from "../lib/feature-flags";
import { parseRouteId } from "../lib/route-id";
import { authorize } from "../middleware/auth";
import {
  createMissionBudget,
  createMissionBudgetExpense,
  dailyNeed,
  deleteMissionBudgetExpense,
  getMissionBudget,
  listMissionBudgetExpenses,
  listMissionBudgets,
  listMissionDestinations,
  settleMissionBudget,
  transitionMissionBudget,
  updateMissionBudget,
} from "../services/mission-budgets-service";

/**
 * Budget de mission (L1, drapeau finance). Saisie : logistique et administrateur ;
 * approbation et décaissement : direction et administrateur ; lecture : les trois.
 */
const budgetId = (raw: string) => parseRouteId(raw, "Identifiant de budget invalide.");

const list: RequestHandler = async (req, res, next) => {
  try {
    const filter = missionBudgetsQuerySchema.parse(req.query);
    res.json(missionBudgetsResponseSchema.parse(await listMissionBudgets(filter)));
  } catch (error) {
    next(error);
  }
};

const need: RequestHandler = async (req, res, next) => {
  try {
    const { date } = dailyNeedQuerySchema.parse(req.query);
    res.json(dailyNeedResponseSchema.parse(await dailyNeed(date)));
  } catch (error) {
    next(error);
  }
};

/** Barème FDR (L1b) : liste fermée des destinations, pour pré-remplir la saisie. */
const destinations: RequestHandler = async (_req, res, next) => {
  try {
    res.json(missionDestinationsResponseSchema.parse(await listMissionDestinations()));
  } catch (error) {
    next(error);
  }
};

const detail: RequestHandler = async (req, res, next) => {
  try {
    res.json(missionBudgetSchema.parse(await getMissionBudget(budgetId(req.params.id))));
  } catch (error) {
    next(error);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const input = createMissionBudgetRequestSchema.parse(req.body);
    res.status(201).json(missionBudgetSchema.parse(await createMissionBudget(req.user!.id, input)));
  } catch (error) {
    next(error);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const id = budgetId(req.params.id);
    const input = updateMissionBudgetRequestSchema.parse(req.body);
    res.json(missionBudgetSchema.parse(await updateMissionBudget(id, req.user!.id, input)));
  } catch (error) {
    next(error);
  }
};

const transition =
  (action: "approve" | "disburse"): RequestHandler =>
  async (req, res, next) => {
    try {
      const id = budgetId(req.params.id);
      // Approuver n'accepte que la version ; décaisser accepte aussi le compte de trésorerie (L1c).
      const { expectedUpdatedAt, treasuryAccountId } =
        action === "disburse"
          ? missionBudgetDisburseRequestSchema.parse(req.body ?? {})
          : { ...missionBudgetTransitionRequestSchema.parse(req.body ?? {}), treasuryAccountId: null };
      res.json(missionBudgetSchema.parse(await transitionMissionBudget(id, req.user!.id, action, expectedUpdatedAt, treasuryAccountId)));
    } catch (error) {
      next(error);
    }
  };

/**
 * Solde d'une mission terminée (Q18) : reliquat rendu au compte source, dépenses figées. Rejouable :
 * un budget déjà soldé est renvoyé tel quel, sans nouvelle écriture.
 */
const settle: RequestHandler = async (req, res, next) => {
  try {
    const { budget } = await settleMissionBudget(budgetId(req.params.id), req.user!.id);
    res.json(missionBudgetSchema.parse(budget));
  } catch (error) {
    next(error);
  }
};

/** Dépenses justifiées (L1e) : lecture comme le budget ; saisie et suppression par qui décaisse. */
const expenseId = (raw: string) => parseRouteId(raw, "Identifiant de dépense invalide.");

const listExpenses: RequestHandler = async (req, res, next) => {
  try {
    res.json(missionBudgetExpensesResponseSchema.parse(await listMissionBudgetExpenses(budgetId(req.params.id))));
  } catch (error) {
    next(error);
  }
};

const createExpense: RequestHandler = async (req, res, next) => {
  try {
    const id = budgetId(req.params.id);
    const input = createMissionBudgetExpenseRequestSchema.parse(req.body);
    res.status(201).json(missionBudgetExpenseSchema.parse(await createMissionBudgetExpense(id, req.user!.id, input)));
  } catch (error) {
    next(error);
  }
};

const deleteExpense: RequestHandler = async (req, res, next) => {
  try {
    await deleteMissionBudgetExpense(budgetId(req.params.id), expenseId(req.params.expenseId), req.user!.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

const router = Router();
// Gardes en ligne : le cliquet des routes d'écriture les lit sur la déclaration.
// /daily-need avant /:id : Express sert la première déclaration qui correspond.
router.get("/mission-budgets/daily-need", requireFeature("finance"), authorize([...MISSION_BUDGET_READ_ROLES]), need);
router.get("/mission-budgets/destinations", requireFeature("finance"), authorize([...MISSION_BUDGET_READ_ROLES]), destinations);
router.get("/mission-budgets", requireFeature("finance"), authorize([...MISSION_BUDGET_READ_ROLES]), list);
router.get("/mission-budgets/:id", requireFeature("finance"), authorize([...MISSION_BUDGET_READ_ROLES]), detail);
router.post("/mission-budgets", requireFeature("finance"), authorize([...MISSION_BUDGET_WRITE_ROLES]), create);
router.patch("/mission-budgets/:id", requireFeature("finance"), authorize([...MISSION_BUDGET_WRITE_ROLES]), update);
router.post("/mission-budgets/:id/approve", requireFeature("finance"), authorize([...MISSION_BUDGET_APPROVE_ROLES]), transition("approve"));
router.post("/mission-budgets/:id/disburse", requireFeature("finance"), authorize([...MISSION_BUDGET_DISBURSE_ROLES]), transition("disburse"));
router.post("/mission-budgets/:id/settle", requireFeature("finance"), authorize([...MISSION_BUDGET_SETTLE_ROLES]), settle);
router.get("/mission-budgets/:id/expenses", requireFeature("finance"), authorize([...MISSION_BUDGET_READ_ROLES]), listExpenses);
router.post("/mission-budgets/:id/expenses", requireFeature("finance"), authorize([...MISSION_BUDGET_DISBURSE_ROLES]), createExpense);
router.delete("/mission-budgets/:id/expenses/:expenseId", requireFeature("finance"), authorize([...MISSION_BUDGET_DISBURSE_ROLES]), deleteExpense);

export default router;
