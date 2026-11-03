import { Router } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { vehicleDocumentTypes } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isWorkshopManager } from "../middleware/auth";
import { deleteFile, uploadVehicleDocument } from "../middleware/upload";
import { storage } from "../storage";
import { syncVehicleDocumentMirror } from "../lib/vehicle-document-mirror";

const log = moduleLogger("vehicle-documents");
const router = Router();

async function removeUploaded(path: string | undefined, requestId?: string): Promise<void> {
  if (!path) return;
  try {
    await deleteFile(path);
  } catch (err) {
    log.warn({ err, requestId }, "suppression du fichier téléversé en échec");
  }
}

/** Couche 2 : le dépôt modifie `vehicles.*` (miroir) et la liste des documents. */
function emitDocumentDeposited(
  req: { user?: { id?: number; role?: string } },
  vehicleId: number,
  document: { id: number; type: string; expiryDate?: string | Date | null },
  mirrorWritten: boolean,
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  const base = {
    version: 1,
    scope: { type: "broadcast" },
    actor: { userId: req.user?.id ?? null, role: req.user?.role ?? null },
    emittedAt: new Date().toISOString(),
  };
  const payload = { vehicleId, documentId: document.id, documentType: document.type, newExpiryDate: document.expiryDate ?? null, source: "document_upload" };
  broadcastUpdate("vehicle_document_updated", { ...base, entity: "vehicle_document", entityId: document.id, payload });
  if (mirrorWritten) {
    broadcastUpdate("vehicle_updated", { ...base, entity: "vehicle", entityId: vehicleId, payload });
  }
}

/**
 * Téléversement d'un document véhicule (déplacé de `server/routes.ts`, T-16b).
 * Même chemin, mêmes droits, même multer et même réponse qu'avant ; en plus, le `type`
 * doit être un code actif de `vehicle_document_types`. Les anciens documents au type
 * hors liste restent lisibles (aucune migration).
 */
router.post("/vehicles/:vehicleId/documents", isWorkshopManager, (req, res, next) => {
  const vehicleId = parseInt(req.params.vehicleId);
  if (isNaN(vehicleId)) return next(new AppError(400, "ID de véhicule invalide"));

  uploadVehicleDocument(req, res, async (err: unknown) => {
    try {
      if (err) {
        const message =
          err instanceof multer.MulterError
            ? err.code === "LIMIT_FILE_SIZE"
              ? "Le fichier dépasse la taille maximale autorisée."
              : "Le fichier téléversé est invalide."
            : err instanceof Error
              ? err.message
              : "Le fichier téléversé est invalide.";
        throw new AppError(400, message, { cause: err });
      }
      const file = req.file;
      if (!file) throw new AppError(400, "Aucun fichier n'a été téléchargé");

      try {
        const { name, type, description, expiryDate } = req.body;
        if (!name || !type) throw new AppError(400, "Nom et type de document requis");

        const [known] = await db
          .select({ code: vehicleDocumentTypes.code })
          .from(vehicleDocumentTypes)
          .where(and(eq(vehicleDocumentTypes.code, String(type)), eq(vehicleDocumentTypes.active, true)))
          .limit(1);
        if (!known) throw new AppError(400, "Type de document inconnu ou inactif.");

        const document = await storage.createVehicleDocument({
          vehicleId,
          name,
          type,
          description: description || null,
          expiryDate: expiryDate || null,
          filename: file.originalname,
          filesize: file.size,
          fileType: file.mimetype,
          filePath: file.path,
          uploadedBy: req.user?.id || null,
        });
        // vehicle_documents fait foi : la colonne miroir de vehicles suit le dépôt.
        // Dépôt : le miroir n'avance que si la date est plus récente (jamais de recul).
        // Si la synchro échoue, la ligne document est retirée (le fichier l'est par le catch).
        let mirrorWritten = false;
        try {
          mirrorWritten = await syncVehicleDocumentMirror(vehicleId, document.type, document.expiryDate, "later");
        } catch (syncError) {
          try {
            await storage.deleteVehicleDocument(document.id);
          } catch (cleanupError) {
            log.error({ err: cleanupError, requestId: req.requestId, documentId: document.id }, "document orphelin après échec de synchro du miroir");
          }
          throw new AppError(500, "Le document n'a pas pu être enregistré. Réessayez.", { cause: syncError });
        }
        emitDocumentDeposited(req, vehicleId, document, mirrorWritten);
        return res.status(201).json(document);
      } catch (inner) {
        await removeUploaded(file.path, req.requestId);
        throw inner;
      }
    } catch (error) {
      next(error);
    }
  });
});

export default router;
