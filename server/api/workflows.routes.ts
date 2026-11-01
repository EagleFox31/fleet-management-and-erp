import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authenticate } from "../middleware/auth";
import { workflowService } from "../services/workflow-service";

const log = moduleLogger("workflows");
const router = Router();

/**
 * Sauvegarde du brouillon d'acquisition de véhicule. Liste blanche des champs :
 * le statut, le propriétaire et les dates ne viennent jamais du corps (un
 * `status: "completed"` à l'étape 5 déclenchait l'activation automatique du
 * véhicule). Montées avant les handlers homonymes de server/routes.ts (gelé).
 */
const workflowFields = {
  currentStep: z.number().int().min(1).max(5),
  workflowData: z.record(z.unknown()),
  uploadedFiles: z.unknown().optional(),
};
const createSchema = z.object({ sessionId: z.string().trim().min(1).max(200), ...workflowFields });
const patchSchema = z.object(workflowFields).partial();

router.post("/workflows/vehicle-acquisition", authenticate, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, "Non authentifié");
    const data = createSchema.parse(req.body);
    const workflow = await workflowService.saveWorkflowState({
      userId,
      sessionId: data.sessionId,
      currentStep: data.currentStep,
      workflowData: data.workflowData,
      uploadedFiles: data.uploadedFiles ?? null,
      status: "in_progress",
    });
    return res.status(200).json(workflow);
  } catch (err) {
    if (err instanceof AppError || err instanceof z.ZodError) return next(err);
    log.error({ err, requestId: req.requestId }, "Échec de la sauvegarde du workflow");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

router.patch("/workflows/vehicle-acquisition/:sessionId", authenticate, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, "Non authentifié");
    const data = patchSchema.parse(req.body);
    const workflow = await workflowService.updateWorkflowState(userId, req.params.sessionId, data);
    return res.status(200).json(workflow);
  } catch (err) {
    if (err instanceof AppError || err instanceof z.ZodError) return next(err);
    log.error({ err, requestId: req.requestId }, "Échec de la mise à jour du workflow");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

export default router;
