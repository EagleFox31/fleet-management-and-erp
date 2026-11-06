import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { activityLogs, users, workOrders } from "@shared/schema";
import { workOrderAuditTrailParamsSchema, workOrderAuditTrailResponseSchema } from "@shared/contracts/work-order-audit-trail";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { toAuditLogRow } from "../lib/audit-log-row";
import { requireFeature } from "../lib/feature-flags";
import { WORK_ORDER_COST_READ_ROLES } from "@shared/constants/roles";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

/** Borne de la colonne `integer` : au-delà, la requête échouerait en 500. */
const MAX_INT = 2_147_483_647;
/** Garde-fou : un OT n'a jamais autant d'écritures auditées. */
const MAX_ROWS = 1000;

/**
 * Historique d'un OT (P-13) : vue du journal d'audit sur `entityType = 'work_order'`,
 * du plus ancien au plus récent. Réservé à WORK_ORDER_COST_READ_ROLES (personnel hors
 * chauffeur, §11) : `details` reprend le corps des écritures, qui peut porter un montant sous une clé
 * hors du masquage des coûts d'OT ou en texte libre. Il n'existe pas de table
 * d'historique de statut d'OT : les changements de statut y figurent via leurs écritures auditées.
 */
router.get("/work-orders/:id/audit-trail", requireFeature("work-order-audit-trail"), authenticate, authorize([...WORK_ORDER_COST_READ_ROLES]), async (req, res, next) => {
  try {
    const parsed = workOrderAuditTrailParamsSchema.safeParse(req.params);
    if (!parsed.success || parsed.data.id > MAX_INT) throw new AppError(400, "Identifiant d'ordre de travail invalide.");
    const { id } = parsed.data;

    const [wo] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, id)).limit(1);
    if (!wo) throw new AppError(404, "Ordre de travail introuvable.");

    const rows = await db
      .select({ log: activityLogs, userName: users.name })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.userId))
      .where(and(eq(activityLogs.entityType, "work_order"), eq(activityLogs.entityId, id)))
      .orderBy(asc(activityLogs.createdAt), asc(activityLogs.id))
      .limit(MAX_ROWS);

    res.json(workOrderAuditTrailResponseSchema.parse(rows.map(toAuditLogRow)));
  } catch (err) {
    next(err);
  }
});

export default router;
