import { Router, type NextFunction, type Request, type Response } from "express";
import { MAINTENANCE_COST_READ_ROLES } from "@shared/constants/roles";
import { AppError } from "../lib/app-error";
import { parseQueryId } from "../lib/route-id";
import { authorize, isStaff } from "../middleware/auth";
import { storage } from "../storage";

const router = Router();

const PERIODS = ["week", "month", "quarter", "year"] as const;
type Period = (typeof PERIODS)[number];

/**
 * Deux lectures « argent / stock » sorties de server/routes.ts (gelé) : leurs erreurs passent
 * par `next(error)` et le gestionnaire central (`{ message, code, requestId }`), au lieu d'une
 * réponse 500 locale sans référence.
 */

/** Mouvements de stock : tous, ou ceux d'une pièce (`?partId=`). Personnel uniquement. */
router.get("/parts/stock-movements", isStaff, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partId = parseQueryId(req.query.partId, "ID de pièce invalide");
    const movements = partId ? await storage.getPartStockHistory(partId) : await storage.getAllStockMovements();
    return res.status(200).json(movements);
  } catch (error) {
    return next(error);
  }
});

/** Coût de maintenance de la flotte sur une période : direction d'atelier seule (ni client ni technicien). */
router.get(
  "/statistics/maintenance-cost/:period",
  authorize([...MAINTENANCE_COST_READ_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const period = req.params.period as Period;
      if (!PERIODS.includes(period)) throw new AppError(400, "Période invalide");
      const cost = await storage.getMaintenanceCost(period);
      return res.status(200).json({ cost });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
