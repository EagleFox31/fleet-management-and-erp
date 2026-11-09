import { Router } from "express";
import { WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authorize } from "../middleware/auth";

const router = Router();

/**
 * Statistiques à montant : gardes seules. Les routes vivent dans server/routes.ts (gelé),
 * qui prend le relais par `next()`.
 * - Le coût de maintenance de la flotte (`MAINTENANCE_COST_READ_ROLES`) est servi par `money-reads.routes.ts`.
 * - KPI de flotte : porte `maintenanceCostPerVehicle`, qui, multiplié par le nombre de véhicules,
 *   redonne le coût total. Réservé à `WORK_ORDER_COST_READ_ROLES` (chauffeur exclu, il a son
 *   propre tableau de bord sans cette requête).
 */
router.get("/statistics/fleet-kpi", authorize([...WORK_ORDER_COST_READ_ROLES]), (_req, _res, next) => next());

export default router;
