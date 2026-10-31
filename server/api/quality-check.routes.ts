import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { qualityCheckParamsSchema, qualityCheckRequestSchema, qualityCheckResponseSchema } from "@shared/contracts/quality-check";
import { workOrderQuality, workOrders } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { authenticate, isWorkshopManager } from "../middleware/auth";

const log = moduleLogger("quality-check");

/** Contrainte d'exclusion de double affectation (btree_gist) : SQLSTATE 23P01. */
function isExclusionViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null);
  return code?.code === "23P01" || code?.cause?.code === "23P01";
}

/**
 * Contrôle qualité d'un OT terminé (P-25, drapeau `quality-check`).
 * Refus : retour `completed` -> `in_progress` (D-17, jamais `pending`) avec motif obligatoire.
 * L'auteur et l'heure viennent de la session, jamais du corps.
 */
const postQualityCheck: RequestHandler = async (req, res, next) => {
  try {
    const { id } = qualityCheckParamsSchema.parse(req.params);
    const body = qualityCheckRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;

    const [current] = await db.select({ id: workOrders.id, status: workOrders.status, technicianId: workOrders.technicianId }).from(workOrders).where(eq(workOrders.id, id));
    if (!current) throw new AppError(404, "Ordre de travail introuvable.");
    if (current.status !== "completed") {
      throw new AppError(409, "Le contrôle qualité ne s'applique qu'à un ordre de travail terminé.", { cause: `statut ${current.status}` });
    }

    const qcAt = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(workOrderQuality)
          .set({ qcStatus: body.result, qcBy: userId, qcAt, qcReason: body.reason?.length ? body.reason : null })
          .where(eq(workOrderQuality.id, id));
        if (body.result === "failed") {
          await tx.update(workOrders).set({ status: "in_progress", updatedBy: userId, updatedAt: qcAt }).where(eq(workOrders.id, id));
        }
      });
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new AppError(409, "Le technicien ou le véhicule est déjà affecté sur cette période : le retour en cours est impossible.", { cause: error });
      }
      throw error;
    }

    const status = body.result === "failed" ? "in_progress" : "completed";
    const broadcast = (global as any).broadcastUpdate;
    if (typeof broadcast === "function") {
      broadcast("work_order_updated", {
        workOrderId: id,
        updates: { status, qcStatus: body.result },
        source: "quality_check",
        triggeredBy: userId,
        scope: { type: "roles", roles: ["admin", "workshop_manager", "technician"] },
      });
    }
    log.info({ workOrderId: id, result: body.result, requestId: req.requestId }, "contrôle qualité enregistré");

    res.status(200).json(
      qualityCheckResponseSchema.parse({
        workOrderId: id,
        qcStatus: body.result,
        qcBy: userId,
        qcAt: qcAt.toISOString(),
        qcReason: body.reason?.length ? body.reason : null,
      }),
    );
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.post("/work-orders/:id/quality-check", requireFeature("quality-check"), authenticate, isWorkshopManager, postQualityCheck);

export default router;
