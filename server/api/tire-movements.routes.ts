import { Router } from "express";
import { tireMovementsQuerySchema } from "@shared/contracts/tire-movements";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { aggregateReadsService } from "../services/aggregate-reads-service";

const router = Router();

/** Historique des mouvements de pneus (montage, démontage, rotation, inspection). */
router.get(
  "/tires/movements",
  requireFeature("tire-movements"),
  authorize(["admin", "management", "workshop_manager", "warehouse", "technician"]),
  async (req, res, next) => {
    try {
      res.json(await aggregateReadsService.tireMovements(tireMovementsQuerySchema.parse(req.query)));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
