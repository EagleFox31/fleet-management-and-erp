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
        await syncVehicleDocumentMirror(vehicleId, document.type, document.expiryDate);
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
