import { Router, type RequestHandler } from "express";
import { driverReportOpensWorkOrder, driverReportRequestSchema } from "@shared/contracts/incidents";
import { authenticate, authorize } from "../middleware/auth";
import { createIncident } from "../services/incident-service";

/**
 * Panne signalée par le chauffeur (DRV2-1, DRV2-2). Hors drapeau `incidents`.
 *
 * POST /api/driver/breakdowns : enregistre la déclaration, alerte le chef d'atelier et l'admin,
 * émet `incident_reported`. Une panne ou un accident (`type`, défaut `breakdown`) ouvre en plus
 * un OT `pending` lié et émet `work_order_created` ; un retard ou un autre signalement, non.
 * Rôles : `driver` (limité aux véhicules de ses affectations actives) et `admin`, comme
 * l'écran `incident-declare` de `client/src/config/lot-screens.ts`.
 * La règle de périmètre vit dans `createIncident` (403 hors affectation).
 */
const postBreakdown: RequestHandler = async (req, res, next) => {
  try {
    const { type, ...input } = driverReportRequestSchema.parse(req.body);
    const openWorkOrder = driverReportOpensWorkOrder(type);
    res.status(201).json(await createIncident(req.user, input, undefined, { openWorkOrder }));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.post("/driver/breakdowns", authenticate, authorize(["driver", "admin"]), postBreakdown);

export default router;
