import { Router } from "express";
import { eq } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { vehicleCostSummaryParamsSchema, vehicleCostSummaryQuerySchema } from "@shared/contracts/vehicle-cost-summary";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { aggregateReadsService } from "../services/aggregate-reads-service";

const router = Router();

/** Coût d'un véhicule : main-d'oeuvre, pièces, carburant. Direction, administration, atelier, logistique. */
router.get(
  "/vehicles/:id/cost-summary",
  requireFeature("vehicle-cost-summary"),
  authorize(["admin", "management", "workshop_manager", "logistics"]),
  async (req, res, next) => {
    try {
      const { id } = vehicleCostSummaryParamsSchema.parse(req.params);
      const query = vehicleCostSummaryQuerySchema.parse(req.query);
      const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)).limit(1);
      if (!vehicle) throw new AppError(404, "Véhicule introuvable.");
      res.json(await aggregateReadsService.vehicleCostSummary(id, query));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
