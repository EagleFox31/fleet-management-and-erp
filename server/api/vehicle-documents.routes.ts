import { Router } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { VEHICLE_DOCUMENT_EVENT_ROLES } from "@shared/constants/roles";
import { vehicleDocuments, vehicleDocumentTypes } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { isWorkshopManager } from "../middleware/auth";
import { deleteFile, isVehicleIdSegment, uploadVehicleDocument } from "../middleware/upload";
import { storage } from "../storage";
import { prepareColumnUpdate } from "../lib/column-validation";
import { recomputeVehicleDocumentMirror, syncVehicleDocumentMirror, syncVehicleDocumentMirrorFromDocuments } from "../lib/vehicle-document-mirror";

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
  const vehicleId = parseRouteId(req.params.vehicleId, "ID de véhicule invalide");

  uploadVehicleDocument(req, res, async (err: unknown) => {
    // Le fichier n'est gardé qu'une fois référencé par un document enregistré (miroir compris) :
    // toute autre sortie le supprime dans le finally, jamais après l'écriture (patron de #178).
    let fileRecorded = false;
    try {
      if (err instanceof AppError) throw err;
      if (err) {
        // Jamais `err.message` : une erreur disque (EACCES, ENOSPC...) porte un chemin du serveur.
        // Le détail reste dans `cause` et dans le journal.
        log.warn({ err, requestId: req.requestId, vehicleId }, "téléversement refusé");
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "Le fichier dépasse la taille maximale autorisée."
            : "Le fichier téléversé est invalide.";
        throw new AppError(400, message, { cause: err });
      }
      const file = req.file;
      if (!file) throw new AppError(400, "Aucun fichier n'a été téléchargé");

      {
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
        // Si la synchro échoue, la ligne document est retirée (le fichier l'est par le finally) ;
        // si ce retrait échoue aussi, la ligne et son fichier sont conservés ensemble.
        let mirrorWritten = false;
        try {
          mirrorWritten = await syncVehicleDocumentMirror(vehicleId, document.type, document.expiryDate, "later");
        } catch (syncError) {
          try {
            await storage.deleteVehicleDocument(document.id);
          } catch (cleanupError) {
            // La ligne reste en base : le fichier qu'elle référence reste aussi (le finally ne le supprime pas).
            fileRecorded = true;
            log.error({ err: cleanupError, requestId: req.requestId, documentId: document.id }, "document orphelin après échec de synchro du miroir");
          }
          throw new AppError(500, "Le document n'a pas pu être enregistré. Réessayez.", { cause: syncError });
        }
        fileRecorded = true;
        // Diffusion au mieux : le document référence déjà le fichier, un échec ici ne touche ni à l'un ni à l'autre.
        try {
          emitDocumentDeposited(req, vehicleId, document, mirrorWritten);
        } catch (broadcastError) {
          log.error({ err: broadcastError, requestId: req.requestId, documentId: document.id }, "diffusion du dépôt de document");
        }
        return res.status(201).json(document);
      }
    } catch (error) {
      next(error);
    } finally {
      if (!fileRecorded) await removeUploaded(req.file?.path, req.requestId);
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
    const id = parseRouteId(req.params.id, "ID de document invalide");
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

/**
 * Correction d'un document (déplacée de `server/routes.ts`, P3-2 D3). Mêmes chemin, droits
 * et réponse. La colonne miroir de `vehicles` est recalée par la lib du miroir sur la plus
 * lointaine échéance des documents du type, au lieu de trois écritures directes.
 */
router.patch("/documents/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, "ID de document invalide");

    const document = await storage.getVehicleDocument(id);
    if (!document) throw new AppError(404, "Document non trouvé");

    const { name, description, expiryDate } = req.body ?? {};
    const previousExpiryDate = document.expiryDate;

    // Une date illisible est refusée ici en 400 lisible, avant toute écriture.
    const { data, errors } = prepareColumnUpdate(vehicleDocuments, { name, description, expiryDate });
    if (typeof data.name === "string" && data.name.trim() === "") {
      errors.push({ field: "name", message: "Ce champ est obligatoire." });
    }
    if (errors.length > 0) {
      throw new AppError(400, "Certaines informations du document sont invalides.", { fieldErrors: errors });
    }

    const updatedDocument = await storage.updateVehicleDocument(id, { ...data, updatedBy: req.user?.id });
    if (!updatedDocument) throw new AppError(404, "Document non trouvé");

    // La ligne est écrite : un échec du recalcul ne la fait pas passer pour ratée (journalisé).
    if (expiryDate !== undefined && updatedDocument.expiryDate) {
      try {
        await syncVehicleDocumentMirrorFromDocuments(updatedDocument.vehicleId, updatedDocument.type);
      } catch (err) {
        log.error({ err, requestId: req.requestId, documentId: id, vehicleId: updatedDocument.vehicleId }, "recalcul du miroir après correction en échec");
      }
    }

    const broadcastUpdate = (global as any).broadcastUpdate;
    if (typeof broadcastUpdate === "function") {
      const base = {
        version: 1,
        scope: STAFF_SCOPE,
        actor: { userId: req.user?.id ?? null, role: req.user?.role ?? null },
        emittedAt: new Date().toISOString(),
      };
      broadcastUpdate("vehicle_document_updated", {
        ...base,
        entity: "document_renewal_request",
        entityId: updatedDocument.id,
        payload: {
          documentId: updatedDocument.id,
          vehicleId: updatedDocument.vehicleId,
          documentType: updatedDocument.type,
          previousExpiryDate: previousExpiryDate ?? null,
          newExpiryDate: updatedDocument.expiryDate ?? null,
          source: "legacy_document_patch",
        },
      });
      broadcastUpdate("vehicle_updated", {
        ...base,
        entity: "vehicle",
        entityId: updatedDocument.vehicleId,
        payload: { vehicleId: updatedDocument.vehicleId, source: "legacy_document_patch" },
      });
    }
    return res.status(200).json(updatedDocument);
  } catch (error) {
    next(error);
  }
});

export default router;
