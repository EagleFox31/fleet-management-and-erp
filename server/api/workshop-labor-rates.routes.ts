import { Router, type RequestHandler } from "express";
import {
  createWorkshopLaborRateRequestSchema,
  workshopLaborRateSchema,
  workshopLaborRatesResponseSchema,
} from "@shared/contracts/workshop-labor-rates";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { createWorkshopLaborRate, listWorkshopLaborRates } from "../services/workshop-labor-rates-service";

/** Couche 2 : un nouveau taux change des coûts d'OT déjà affichés ; les écrans concernés ré-interrogent. */
function broadcastRateCreated(effectiveFrom: string): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  broadcastUpdate("workshop_labor_rate_created", {
    entity: "workshop_labor_rate",
    payload: { effectiveFrom },
    scope: REALTIME_EVENTS.workshop_labor_rate_created.scope,
  });
}

/**
 * Taux horaires de main-d'oeuvre de l'atelier (CDC #7). Monté sur `/api/workshop-labor-rates`
 * derrière le drapeau `maintenance-report` et `isAdmin` (server/api/index.ts) : administrateur seul.
 */
const list: RequestHandler = async (_req, res, next) => {
  try {
    res.status(200).json(workshopLaborRatesResponseSchema.parse(await listWorkshopLaborRates()));
  } catch (error) {
    next(error);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const input = createWorkshopLaborRateRequestSchema.parse(req.body);
    const created = workshopLaborRateSchema.parse(await createWorkshopLaborRate(req.user!.id, input));
    broadcastRateCreated(created.effectiveFrom);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/", list);
router.post("/", create);

export default router;
