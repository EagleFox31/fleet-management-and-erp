import { Router, type RequestHandler } from "express";
import {
  createMissionBudgetRequestSchema,
  dailyNeedQuerySchema,
  dailyNeedResponseSchema,
  missionBudgetSchema,
  missionBudgetTransitionRequestSchema,
  missionBudgetsQuerySchema,
  missionBudgetsResponseSchema,
  missionDestinationsResponseSchema,
  updateMissionBudgetRequestSchema,
} from "@shared/contracts/mission-budgets";
import {
  MISSION_BUDGET_APPROVE_ROLES,
  MISSION_BUDGET_READ_ROLES,
  MISSION_BUDGET_WRITE_ROLES,
} from "@shared/constants/roles";
import { requireFeature } from "../lib/feature-flags";
import { parseRouteId } from "../lib/route-id";
import { authorize } from "../middleware/auth";
import {
  createMissionBudget,
  dailyNeed,
  getMissionBudget,
  listMissionBudgets,
  listMissionDestinations,
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
      const { expectedUpdatedAt } = missionBudgetTransitionRequestSchema.parse(req.body ?? {});
      res.json(missionBudgetSchema.parse(await transitionMissionBudget(id, req.user!.id, action, expectedUpdatedAt)));
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
router.post("/mission-budgets/:id/disburse", requireFeature("finance"), authorize([...MISSION_BUDGET_APPROVE_ROLES]), transition("disburse"));

export default router;
