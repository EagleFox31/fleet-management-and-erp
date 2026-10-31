import { Router } from "express";
import { kpiQuerySchema } from "@shared/contracts/kpi";
import { isManagementOrAdmin } from "../middleware/auth";
import { kpiService } from "../services/kpi-service";

const router = Router();

/** Indicateurs de la direction (P-10) : lecture seule, réservée à la direction et à l'administrateur. */
router.get("/kpi/incidents-per-month", isManagementOrAdmin, async (req, res, next) => {
  try {
    res.json(await kpiService.incidentsPerMonth(kpiQuerySchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get("/kpi/preventive-compliance", isManagementOrAdmin, async (req, res, next) => {
  try {
    res.json(await kpiService.preventiveCompliance(kpiQuerySchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get("/kpi/avg-cost-per-intervention", isManagementOrAdmin, async (req, res, next) => {
  try {
    res.json(await kpiService.avgCostPerIntervention(kpiQuerySchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

export default router;
