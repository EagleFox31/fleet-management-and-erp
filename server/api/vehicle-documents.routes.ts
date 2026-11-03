import { Router } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { VEHICLE_DOCUMENT_EVENT_ROLES } from "@shared/constants/roles";
import { vehicleDocumentTypes } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isWorkshopManager } from "../middleware/auth";
import { deleteFile, isVehicleIdSegment, uploadVehicleDocument } from "../middleware/upload";
import { storage } from "../storage";
import { recomputeVehicleDocumentMirror, syncVehicleDocumentMirror } from "../lib/vehicle-document-mirror";

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
 * Cloison (AGENTS.md §11) : ces événements portent véhicule, type de papier, échéance et
 * acteur. Seul le personnel les reçoit, ni client ni chauffeur : jamais en broadcast.
 */
const STAFF_SCOPE = { type: "roles", roles: [...VEHICLE_DOCUMENT_EVENT_ROLES] } as const;

const expiryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

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
    scope: STAFF_SCOPE,
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
  // Chiffres seuls : multer fait de ce paramètre un dossier disque, `parseInt` laisserait passer `1../../x` (#130).
  if (!isVehicleIdSegment(req.params.vehicleId)) return next(new AppError(400, "ID de véhicule invalide"));
  const vehicleId = Number(req.params.vehicleId);

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
        if (expiryDate && !expiryDateSchema.safeParse(expiryDate).success) {
          throw new AppError(400, "La date d'échéance est invalide (format attendu : AAAA-MM-JJ).");
        }

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

/**
 * Suppression d'un document véhicule (déplacée de `server/routes.ts`, gelé, où l'ancien
 * handler a été retiré). Mêmes droits, même réponse 204/404.
 * En plus : le miroir `vehicles.*` est recalé sur les documents restants du type quand le
 * document supprimé le fixait, car le dépôt ne le fait qu'avancer ; un document saisi par
 * erreur ne laisse plus le véhicule éligible.
 */
router.delete("/documents/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError(400, "ID de document invalide");
    const document = await storage.getVehicleDocument(id);
    if (!document) throw new AppError(404, "Document non trouvé");
    // Faux si un autre utilisateur l'a supprimé entre la lecture et la suppression.
    const deleted = await storage.deleteVehicleDocument(id);
    if (!deleted) throw new AppError(404, "Document non trouvé");

    // La suppression a eu lieu : un échec du recalcul ne doit pas la faire passer pour ratée
    // (un 5xx devient un message générique, et un nouvel essai répondrait 404). On le journalise.
    let mirrorChanged = false;
    try {
      mirrorChanged = await recomputeVehicleDocumentMirror(document.vehicleId, document.type, document.expiryDate);
    } catch (err) {
      log.error({ err, requestId: req.requestId, documentId: id, vehicleId: document.vehicleId }, "recalcul du miroir après suppression en échec");
    }

    // `documentId` dans un `vehicle_updated` : le client resynchronise la liste des
    // documents, les KPI conformité et les alertes d'échéance.
    const broadcastUpdate = (global as any).broadcastUpdate;
    if (typeof broadcastUpdate === "function") {
      broadcastUpdate("vehicle_updated", {
        version: 1,
        entity: "vehicle",
        entityId: document.vehicleId,
        payload: {
          vehicleId: document.vehicleId,
          documentId: document.id,
          documentType: document.type,
          source: "document_deleted",
          mirrorChanged,
        },
        scope: STAFF_SCOPE,
        actor: { userId: req.user?.id ?? null, role: req.user?.role ?? null },
        emittedAt: new Date().toISOString(),
      });
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
