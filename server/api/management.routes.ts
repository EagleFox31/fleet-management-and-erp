import { Router, type Request, type Response } from "express";
import {
  MANAGEMENT_PERIODS,
  type ManagementPeriod,
} from "@shared/constants/management-dashboard";
import { authenticate, isManagementOrAdmin } from "../middleware/auth";
import { managementDashboardService } from "../services/management-dashboard-service";

const router = Router();

/**
 * GET /api/management/dashboard?period=month
 * Vue agrégée Direction — lecture seule.
 */
router.get("/dashboard", authenticate, isManagementOrAdmin, async (req: Request, res: Response) => {
  try {
    const rawPeriod = String(req.query.period ?? "month");
    const period = (MANAGEMENT_PERIODS.includes(rawPeriod as ManagementPeriod)
      ? rawPeriod
      : "month") as ManagementPeriod;

    const dashboard = await managementDashboardService.getDashboard(period);
    return res.status(200).json(dashboard);
  } catch (error) {
    console.error("Management dashboard error:", error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Erreur serveur",
    });
  }
});

export default router;
