import { Router } from "express";
import { WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authorize } from "../middleware/auth";

const router = Router();

/**
 * Coût de maintenance de la flotte : réservé à `WORK_ORDER_COST_READ_ROLES` (le chauffeur et le
 * client en sont exclus). Garde seule : la route vit dans server/routes.ts (gelé), qui garde ses
 * propres refus et prend le relais par `next()`.
 */
router.get("/statistics/maintenance-cost/:period", authorize([...WORK_ORDER_COST_READ_ROLES]), (_req, _res, next) => next());

export default router;
