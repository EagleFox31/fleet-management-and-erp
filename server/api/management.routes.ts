import { Router, type NextFunction, type Request, type Response } from "express";
import {
  MANAGEMENT_PERIODS,
  type ManagementPeriod,
} from "@shared/constants/management-dashboard";
import { authenticate, isManagementOrAdmin } from "../middleware/auth";
import { managementDashboardService } from "../services/management-dashboard-service";
import { managementTeamService } from "../services/management-team-service";
import { moduleLogger } from "../lib/logger";

const router = Router();
const log = moduleLogger("management-routes");

/**
 * GET /api/management/dashboard?period=month
 * Vue agrégée Direction — lecture seule.
 */
router.get("/dashboard", authenticate, isManagementOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawPeriod = String(req.query.period ?? "month");
    const period = (MANAGEMENT_PERIODS.includes(rawPeriod as ManagementPeriod)
      ? rawPeriod
      : "month") as ManagementPeriod;

    const dashboard = await managementDashboardService.getDashboard(period);
    return res.status(200).json(dashboard);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Management dashboard error");
    return next(error);
  }
});

/**
 * GET /api/management/team?period=month
 * Effectifs par pôle et décisions DG — lecture seule.
 */
router.get("/team", authenticate, isManagementOrAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawPeriod = String(req.query.period ?? "month");
    const period = (MANAGEMENT_PERIODS.includes(rawPeriod as ManagementPeriod)
      ? rawPeriod
      : "month") as ManagementPeriod;

    const team = await managementTeamService.getTeam(period);
    return res.status(200).json(team);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Management team error");
    return next(error);
  }
});

export default router;
