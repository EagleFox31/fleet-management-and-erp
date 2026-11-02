import { Router, type NextFunction, type Request, type Response } from "express";
import { kpiQuerySchema, maintenanceCostsQuerySchema } from "@shared/contracts/kpi";
import { KPI_VIEWER_ROLES } from "@shared/constants/roles";
import { authorize } from "../middleware/auth";
import { kpiService } from "../services/kpi-service";

const router = Router();

/**
 * Indicateurs de pilotage (P-10, CDC #7) : lecture seule, réservée à `KPI_VIEWER_ROLES`
 * (direction, administrateur, chef d'atelier). Même source que l'écran et l'export `kpi-report`.
 */
const viewers = authorize([...KPI_VIEWER_ROLES]);

function handle(run: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await run(req));
    } catch (err) {
      next(err);
    }
  };
}

router.get("/kpi/incidents-per-month", viewers, handle((req) => kpiService.incidentsPerMonth(kpiQuerySchema.parse(req.query))));
router.get("/kpi/failures", viewers, handle((req) => kpiService.failures(kpiQuerySchema.parse(req.query))));
router.get("/kpi/preventive-compliance", viewers, handle((req) => kpiService.preventiveCompliance(kpiQuerySchema.parse(req.query))));
router.get("/kpi/avg-cost-per-intervention", viewers, handle((req) => kpiService.avgCostPerIntervention(kpiQuerySchema.parse(req.query))));
router.get("/kpi/maintenance-costs", viewers, handle((req) => kpiService.maintenanceCosts(maintenanceCostsQuerySchema.parse(req.query))));

export default router;
