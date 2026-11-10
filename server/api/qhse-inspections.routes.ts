import { Router, type RequestHandler } from "express";
import {
  createQhseCriterionRequestSchema,
  createQhseInspectionRequestSchema,
  qhseCriteriaQuerySchema,
  qhseInspectionsQuerySchema,
  updateQhseCriterionRequestSchema,
} from "@shared/contracts/qhse-inspections";
import { parseRouteId } from "../lib/route-id";
import { QHSE_CRITERIA_MANAGER_ROLES, QHSE_INSPECTION_ROLES } from "@shared/constants/roles";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate-body";
import {
  createCriterion,
  createInspection,
  getInspection,
  listCriteria,
  listInspections,
  updateCriterion,
} from "../services/qhse-inspection-service";

/**
 * Contrôles inopinés QHSE (lot Q1), derrière le drapeau `qhse` (coupé : 404).
 *
 * - saisie et lecture de tous les contrôles : admin, management, logistics (`QHSE_INSPECTION_ROLES`) ;
 * - grille de critères : lecture par ces trois rôles, modification par admin et management ;
 * - chauffeur : lecture de ses seuls contrôles (`driverScopeOf` dans le service), jamais d'écriture ;
 * - `authorize` charge `req.user` ; tout autre rôle (dont `client`) reçoit 403.
 */
function actorOf(req: Parameters<RequestHandler>[0]) {
  if (!req.user) throw new AppError(401, "Non authentifié.");
  return req.user;
}

const router = Router();
const flag = requireFeature("qhse");
const staffOrDriver = authorize([...QHSE_INSPECTION_ROLES, "driver"]);

router.get("/qhse/criteria", flag, authorize([...QHSE_INSPECTION_ROLES]), async (req, res, next) => {
  try {
    res.json(await listCriteria(qhseCriteriaQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});

router.post("/qhse/criteria", flag, authorize([...QHSE_CRITERIA_MANAGER_ROLES]), validateBody(createQhseCriterionRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createCriterion(actorOf(req), req.body));
  } catch (error) {
    next(error);
  }
});

router.patch("/qhse/criteria/:id", flag, authorize([...QHSE_CRITERIA_MANAGER_ROLES]), validateBody(updateQhseCriterionRequestSchema), async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "Critère invalide.");
    res.json(await updateCriterion(actorOf(req), id, req.body));
  } catch (error) {
    next(error);
  }
});

router.get("/qhse/inspections", flag, staffOrDriver, async (req, res, next) => {
  try {
    res.json(await listInspections(actorOf(req), qhseInspectionsQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});

router.get("/qhse/inspections/:id", flag, staffOrDriver, async (req, res, next) => {
  try {
    res.json(await getInspection(actorOf(req), parseRouteId(req.params.id, "Inspection invalide.")));
  } catch (error) {
    next(error);
  }
});

router.post("/qhse/inspections", flag, authorize([...QHSE_INSPECTION_ROLES]), validateBody(createQhseInspectionRequestSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createInspection(actorOf(req), req.body));
  } catch (error) {
    next(error);
  }
});

export default router;
