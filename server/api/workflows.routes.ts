import { Router } from "express";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isWorkflowDocumentWriter } from "../middleware/auth";
import { validateBody } from "../middleware/validate-body";
import { workflowService } from "../services/workflow-service";
import { withLogContext } from "../lib/error-log-context";
import { workflowCreateRequestSchema, workflowPatchRequestSchema } from "@shared/contracts/vehicle-acquisition";

const log = moduleLogger("workflows");
const router = Router();

/**
 * Sauvegarde du brouillon d'acquisition de véhicule. Montées avant les handlers homonymes de
 * server/routes.ts (gelé). Garde : `isWorkflowDocumentWriter` (personnel d'acquisition et client,
 * qui alimente sa propre session). Cloison : la session est celle de `req.session.userId`, un
 * autre compte ne la lit ni ne la modifie (404). Schémas : shared/contracts/vehicle-acquisition.ts.
 */
router.post("/workflows/vehicle-acquisition", isWorkflowDocumentWriter, validateBody(workflowCreateRequestSchema), async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, "Non authentifié");
    const data = req.body as ReturnType<typeof workflowCreateRequestSchema.parse>;
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
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la sauvegarde du workflow" }));
  }
});

router.patch("/workflows/vehicle-acquisition/:sessionId", isWorkflowDocumentWriter, validateBody(workflowPatchRequestSchema), async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (!userId) throw new AppError(401, "Non authentifié");
    const data = req.body as ReturnType<typeof workflowPatchRequestSchema.parse>;
    const workflow = await workflowService.updateWorkflowState(userId, req.params.sessionId, data);
    if (!workflow) throw new AppError(404, "Brouillon d'acquisition introuvable.");
    return res.status(200).json(workflow);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la mise à jour du workflow" }));
  }
});

export default router;
