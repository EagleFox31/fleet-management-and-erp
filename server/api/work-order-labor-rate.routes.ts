import { Router } from "express";
import { isStaff } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { laborRateForWorkOrder } from "../services/workshop-labor-rates-service";

/**
 * Taux horaire en vigueur pour un OT, monté sur `/api/work-orders`.
 *
 * L'écran de détail et le PDF de l'OT en ont besoin pour appliquer la même règle de
 * main-d'oeuvre que le KPI de coût (`shared/work-order-cost.ts`). La liste complète des
 * taux reste réservée à l'admin (`/api/workshop-labor-rates`) : ici, un seul taux, celui
 * qui s'applique à l'OT demandé. Réponse : `{ effectiveFrom, hourlyRateHt }` ou `null`.
 */
export const workOrderLaborRateRoutes = Router();

workOrderLaborRateRoutes.get("/:workOrderId/labor-rate", isStaff, async (req, res, next) => {
  try {
    const workOrderId = Number(req.params.workOrderId);
    if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
      throw new AppError(400, "Identifiant d'ordre de travail invalide.");
    }
    res.json(await laborRateForWorkOrder(workOrderId));
  } catch (err) {
    next(err);
  }
});
