import { Router } from "express";
import { WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authorize } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { laborRateForWorkOrder, workOrderExists } from "../services/workshop-labor-rates-service";

/** Plus grand `integer` Postgres : au-delà, la conversion échouerait en 500. */

/**
 * Taux horaire en vigueur pour un OT, monté sur `/api/work-orders`.
 *
 * L'écran de détail et le PDF de l'OT en ont besoin pour appliquer la même règle de
 * main-d'oeuvre que le KPI de coût (`shared/work-order-cost.ts`). La liste complète des
 * taux reste réservée à l'admin (`/api/workshop-labor-rates`) : ici, un seul taux, celui
 * qui s'applique à l'OT demandé, pour `WORK_ORDER_COST_READ_ROLES` (personnel hors chauffeur).
 * Réponse : `{ effectiveFrom, hourlyRateHt }`, `null` sans taux applicable, 404 si l'OT n'existe pas.
 */
export const workOrderLaborRateRoutes = Router();

workOrderLaborRateRoutes.get("/:workOrderId/labor-rate", authorize([...WORK_ORDER_COST_READ_ROLES]), async (req, res, next) => {
  try {
    const workOrderId = parseRouteId(req.params.workOrderId, "Identifiant d'ordre de travail invalide.");
    const rate = await laborRateForWorkOrder(workOrderId);
    if (rate === null && !(await workOrderExists(workOrderId))) {
      throw new AppError(404, "Ordre de travail introuvable.");
    }
    res.json(rate);
  } catch (err) {
    next(err);
  }
});
