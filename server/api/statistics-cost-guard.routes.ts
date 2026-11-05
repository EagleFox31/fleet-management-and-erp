import { Router } from "express";
import { MAINTENANCE_COST_READ_ROLES, WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authorize } from "../middleware/auth";

const router = Router();

/**
 * Statistiques à montant : gardes seules. Les routes vivent dans server/routes.ts (gelé),
 * qui prend le relais par `next()`.
 * - Coût de maintenance de la flotte : direction d'atelier seule (`MAINTENANCE_COST_READ_ROLES`).
 * - KPI de flotte : porte `maintenanceCostPerVehicle`, qui, multiplié par le nombre de véhicules,
 *   redonne le coût total. Réservé à `WORK_ORDER_COST_READ_ROLES` (chauffeur exclu, il a son
 *   propre tableau de bord sans cette requête).
 */
router.get("/statistics/maintenance-cost/:period", authorize([...MAINTENANCE_COST_READ_ROLES]), (_req, _res, next) => next());
router.get("/statistics/fleet-kpi", authorize([...WORK_ORDER_COST_READ_ROLES]), (_req, _res, next) => next());

export default router;
