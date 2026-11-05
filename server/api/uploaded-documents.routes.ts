import { Router } from "express";
import { AppError } from "../lib/app-error";
import { canAccessOwned, ownerScopeOf, OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { parseRouteId } from "../lib/route-id";
import { sendUploadedFile } from "../lib/uploaded-file-response";
import { assertVehicleSubresourcesReadable } from "../lib/vehicle-subresource-guard";
import { isAnyUser } from "../middleware/auth";
import { storage } from "../storage";
import { WorkflowDocumentService } from "../services/workflow-document-service";

/**
 * Téléchargement des fichiers téléversés (documents véhicule, documents d'acquisition).
 * Sortis de routes.ts : ce routeur est monté avant `registerRoutes`, il sert seul ces chemins.
 * Cloison §11 : un client ne lit que les documents de ses véhicules ou de ses sessions ; un id
 * inconnu lui répond comme un id hors périmètre. Document d'un véhicule retiré : 403 au client
 * propriétaire, comme la liste des documents de ce véhicule ; le personnel le télécharge.
 */
const router = Router();

function unknownDocument(user: Parameters<typeof ownerScopeOf>[0]): AppError {
  if (ownerScopeOf(user) !== null) return new AppError(403, OUT_OF_SCOPE_MESSAGE);
  return new AppError(404, "Document non trouvé");
}

router.get("/documents/:id/download", isAnyUser, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "ID de document invalide");
    const document = await storage.getVehicleDocument(id);
    if (!document) throw unknownDocument(req.user);
    await assertVehicleSubresourcesReadable(req, document.vehicleId);
    const file = { mimeType: document.fileType, downloadName: document.filename, notFoundMessage: "Fichier introuvable sur le serveur", failureMessage: "Erreur lors du téléchargement" };
    sendUploadedFile(res, document.filePath, file, next, req.requestId);
  } catch (error) {
    next(error);
  }
});

router.get("/workflows/documents/:documentId", isAnyUser, async (req, res, next) => {
  try {
    const documentId = parseRouteId(req.params.documentId, "ID de document invalide");
    const document = await WorkflowDocumentService.getWorkflowDocument(documentId);
    if (!document) throw unknownDocument(req.user);
    if (!(await canAccessOwned(req.user, () => WorkflowDocumentService.getWorkflowOwnerId(document.workflowId)))) {
      throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
    }
    const file = { mimeType: document.mimeType, downloadName: document.originalName, notFoundMessage: "Fichier non trouvé", failureMessage: "Erreur lors du téléchargement du document" };
    sendUploadedFile(res, document.filePath, file, next, req.requestId);
  } catch (error) {
    next(error);
  }
});

export default router;
