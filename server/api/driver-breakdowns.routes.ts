import { Router, type RequestHandler } from "express";
import { createIncidentRequestSchema } from "@shared/contracts/incidents";
import { authenticate, authorize } from "../middleware/auth";
import { createIncident } from "../services/incident-service";

/**
 * Panne signalée par le chauffeur (DRV2-1, DRV2-2). Hors drapeau `incidents`.
 *
 * POST /api/driver/breakdowns : enregistre la déclaration, ouvre un OT `pending` lié, alerte le
 * chef d'atelier et l'admin, émet `incident_reported` et `work_order_created`.
 * Rôles : `driver` (limité aux véhicules de ses affectations actives) et `admin`, comme
 * l'écran `incident-declare` de `client/src/config/lot-screens.ts`.
 * La règle de périmètre vit dans `createIncident` (403 hors affectation).
 */
const postBreakdown: RequestHandler = async (req, res, next) => {
  try {
    const input = createIncidentRequestSchema.parse(req.body);
    res.status(201).json(await createIncident(req.user, input, undefined, { openWorkOrder: true }));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.post("/driver/breakdowns", authenticate, authorize(["driver", "admin"]), postBreakdown);

export default router;
