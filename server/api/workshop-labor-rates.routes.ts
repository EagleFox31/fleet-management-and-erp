import { Router, type RequestHandler } from "express";
import {
  createWorkshopLaborRateRequestSchema,
  workshopLaborRateSchema,
  workshopLaborRatesResponseSchema,
} from "@shared/contracts/workshop-labor-rates";
import { createWorkshopLaborRate, listWorkshopLaborRates } from "../services/workshop-labor-rates-service";

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
    res.status(201).json(workshopLaborRateSchema.parse(await createWorkshopLaborRate(req.user!.id, input)));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/", list);
router.post("/", create);

export default router;
