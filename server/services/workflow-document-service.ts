import { db } from "../db";
import { workflowDocuments, vehicleAcquisitionWorkflows, vehicleDocuments } from "../../shared/schema";
import { eq, and, inArray, lt, type SQL } from "drizzle-orm";
import { randomBytes } from "crypto";
import path from "path";
import fs from "fs";
import { AppError } from "../lib/app-error";
import { normalizeVehicleDocumentType, type VehicleDocumentTypeCode } from "../../shared/constants/vehicle-document-types";
import { moduleLogger } from "../lib/logger";
import { isInsideDirectory, isSafePathSegment, realPathStaysInside, uploadedFileCandidates } from "../lib/uploaded-file";

const log = moduleLogger("workflow-documents");

type WorkflowDocumentType = (typeof workflowDocuments.documentType.enumValues)[number];

export function isWorkflowDocumentType(value: unknown): value is WorkflowDocumentType {
  return (workflowDocuments.documentType.enumValues as readonly unknown[]).includes(value);
}

/**
 * Type côté véhicule : la facture d'achat n'y a pas de catégorie propre. Passe par la normalisation
 * partagée comme tout écrivain de vehicle_documents ; les codes produits sont ceux de la graine.
 */
function toVehicleDocumentType(type: WorkflowDocumentType): VehicleDocumentTypeCode {
  const code = type === "factur_achat" ? "autre" : type;
  return normalizeVehicleDocumentType(code) as typeof code;
}

/** Fichier existant sous `uploads/` pour un chemin stocké, sinon `undefined`. */
function existingUploadedFile(storedPath: string | null | undefined): string | undefined {
  return uploadedFileCandidates(storedPath).find((candidate) => fs.existsSync(candidate));
}

interface WorkflowDocumentData {
  workflowId: number;
  sessionId: string;
  documentType: WorkflowDocumentType;
  originalName: string;
  fileBuffer: Buffer;
  mimeType: string;
  uploadedBy: number;
}

export class WorkflowDocumentService {

  /**
   * Sauvegarde un document uploadé pendant un workflow
   */
  static async saveWorkflowDocument(data: WorkflowDocumentData): Promise<any> {
    // sessionId et documentType deviennent des segments de chemin disque.
    if (!isSafePathSegment(data.sessionId) || !isWorkflowDocumentType(data.documentType)) {
      throw new AppError(400, "Session ou type de document invalide.");
    }
    try {
      // Générer un nom unique pour le fichier
      const timestamp = Date.now();
      const extension = path.extname(data.originalName).replace(/[^.A-Za-z0-9]/g, "");
      const storedName = `${data.documentType}_${timestamp}_${Math.random().toString(36).substring(7)}${extension}`;
      
      // Créer le dossier de destination
      const uploadDir = path.join(process.cwd(), 'uploads', 'workflows', data.sessionId);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      // Chemin complet du fichier
      const filePath = path.join(uploadDir, storedName);
      const relativeFilePath = `/uploads/workflows/${data.sessionId}/${storedName}`;
      
      // Sauvegarder le fichier
      fs.writeFileSync(filePath, data.fileBuffer);
      
      // Enregistrer en base de données. Un INSERT refusé ne doit pas laisser de fichier
      // orphelin : aucune ligne ne permettrait plus de le retrouver ni de le supprimer.
      const [document] = await db.insert(workflowDocuments).values({
        workflowId: data.workflowId,
        sessionId: data.sessionId,
        documentType: data.documentType,
        originalName: data.originalName,
        storedName: storedName,
        filePath: relativeFilePath,
        fileSize: data.fileBuffer.length,
        mimeType: data.mimeType,
        uploadedBy: data.uploadedBy,
      }).returning().catch((insertError) => {
        try {
          fs.rmSync(filePath, { force: true });
        } catch (err) {
          log.warn({ err, sessionId: data.sessionId, storedName }, "fichier du document refusé non supprimé");
        }
        throw insertError;
      });

      log.info({ documentType: data.documentType, sessionId: data.sessionId }, "document workflow sauvegardé");
      return document;

    } catch (error) {
      log.error({ err: error, sessionId: data.sessionId }, "sauvegarde du document workflow en échec");
      throw error;
    }
  }
  
  /**
   * Récupère tous les documents d'un workflow. `ownerId` (cloison client) : ne
   * garder que les documents des workflows créés par ce propriétaire. Le filtre
   * porte sur le workflow, pas sur `sessionId`, qui n'est pas unique.
   */
  static async getWorkflowDocuments(sessionId: string, ownerId: number | null = null, workflowId?: number): Promise<any[]> {
    try {
      const conditions: SQL[] = [eq(workflowDocuments.sessionId, sessionId)];
      if (workflowId !== undefined) conditions.push(eq(workflowDocuments.workflowId, workflowId));
      if (ownerId !== null) {
        conditions.push(
          inArray(
            workflowDocuments.workflowId,
            db
              .select({ id: vehicleAcquisitionWorkflows.id })
              .from(vehicleAcquisitionWorkflows)
              .where(eq(vehicleAcquisitionWorkflows.userId, ownerId)),
          ),
        );
      }
      const documents = await db
        .select()
        .from(workflowDocuments)
        .where(and(...conditions))
        .orderBy(workflowDocuments.uploadedAt);
      
      return documents;
    } catch (error) {
      log.error({ err: error, sessionId }, "lecture des documents workflow en échec");
      throw error;
    }
  }
  
  /**
   * Transfère les documents d'un workflow vers un véhicule créé. `sessionId` n'est pas unique
   * entre utilisateurs : le filtre porte aussi sur `workflowId`, sinon le transfert de B
   * emporterait les documents de A.
   */
  static async transferDocumentsToVehicle(sessionId: string, vehicleId: number, workflowId: number): Promise<void> {
    try {
      // Récupérer les documents du workflow
      // Seuls les documents pas encore transférés : un rejeu ne duplique rien dans vehicle_documents.
      const documents = (await this.getWorkflowDocuments(sessionId, null, workflowId)).filter((doc) => !doc.isTransferred);

      // Copier les fichiers vers le dossier du véhicule
      // Référence du contrôle réel : la racine possédée, jamais le dossier calculé depuis l'id
      // (un `vehicle-<id>` remplacé par un lien se résoudrait lui-même et passerait).
      const documentsRoot = path.join(process.cwd(), 'uploads', 'documents');
      const vehicleUploadDir = path.join(documentsRoot, `vehicle-${vehicleId}`);
      if (!realPathStaysInside(documentsRoot, vehicleUploadDir)) {
        // Avant tout mkdir : rien n'est créé ni copié dehors, les documents restent non transférés.
        log.warn({ sessionId, vehicleId, reason: "dossier du véhicule hors de uploads/documents" }, "documents workflow non transférés");
        return;
      }
      if (!fs.existsSync(vehicleUploadDir)) {
        fs.mkdirSync(vehicleUploadDir, { recursive: true });
      }
      
      const transferredIds: number[] = [];
      for (const doc of documents) {
        const originalPath = existingUploadedFile(doc.filePath);
        // Le nom d'origine vient du client : sans répertoire, il reste dans le dossier du véhicule.
        // Aléa dans le nom : deux pièces de même type et de même nom ne s'écrasent pas sur le disque.
        const newFileName = `${doc.documentType}_${randomBytes(6).toString("hex")}_${path.basename(doc.originalName)}`;
        const newPath = path.join(vehicleUploadDir, newFileName);

        // Copier le fichier (destination bornée au dossier du véhicule, cf. AGENTS.md §9)
        if (!originalPath || !isInsideDirectory(vehicleUploadDir, newPath) || !realPathStaysInside(documentsRoot, newPath)) {
          // Ni copié ni marqué : le document reste dans le workflow, visible comme non transféré.
          log.warn(
            { sessionId, vehicleId, docId: doc.id, reason: originalPath ? "destination hors du dossier du véhicule" : "fichier source introuvable" },
            "document workflow non transféré",
          );
          continue;
        }

        // COPYFILE_EXCL : une collision de nom échoue au lieu d'écraser le contenu d'un autre document.
        fs.copyFileSync(originalPath, newPath, fs.constants.COPYFILE_EXCL);

        // Créer l'entrée dans vehicle_documents (requête paramétrée : le nom d'origine peut contenir une apostrophe)
        // Ligne véhicule et marque « transféré » dans la même transaction : l'une sans l'autre
        // dupliquerait le document au rejeu. Le garde isTransferred = false écarte un rejeu concurrent.
        const inserted = await db.transaction(async (tx) => {
          const [claimed] = await tx
            .update(workflowDocuments)
            .set({ vehicleId, isTransferred: true })
            .where(and(eq(workflowDocuments.id, doc.id), eq(workflowDocuments.workflowId, workflowId), eq(workflowDocuments.isTransferred, false)))
            .returning({ id: workflowDocuments.id });
          if (!claimed) return false;
          await tx.insert(vehicleDocuments).values({
            vehicleId,
            name: doc.originalName,
            type: toVehicleDocumentType(doc.documentType),
            description: "Document transféré depuis le workflow d'acquisition",
            filename: newFileName,
            filesize: doc.fileSize,
            fileType: doc.mimeType,
            filePath: `/uploads/documents/vehicle-${vehicleId}/${newFileName}`,
            uploadedBy: doc.uploadedBy,
          });
          return true;
        });
        if (inserted) transferredIds.push(doc.id);
      }
      
      log.info({ sessionId, vehicleId, transferred: transferredIds.length, skipped: documents.length - transferredIds.length }, "documents workflow transférés au véhicule");

    } catch (error) {
      log.error({ err: error, sessionId, vehicleId }, "transfert des documents workflow en échec");
      throw error;
    }
  }
  
  /** Auteur du workflow (`undefined` si le workflow n'existe pas). */
  static async getWorkflowOwnerId(workflowId: number, sessionId?: string): Promise<number | undefined> {
    const [row] = await db
      .select({ userId: vehicleAcquisitionWorkflows.userId })
      .from(vehicleAcquisitionWorkflows)
      .where(and(
        eq(vehicleAcquisitionWorkflows.id, workflowId),
        // Avec une session : le workflow doit porter ce sessionId, sinon pas de propriétaire.
        ...(sessionId === undefined ? [] : [eq(vehicleAcquisitionWorkflows.sessionId, sessionId)]),
      ))
      .limit(1);
    return row?.userId;
  }

  /**
   * Récupère un document workflow spécifique
   */
  static async getWorkflowDocument(documentId: number): Promise<any | null> {
    try {
      const [document] = await db
        .select()
        .from(workflowDocuments)
        .where(eq(workflowDocuments.id, documentId));
      
      return document || null;
    } catch (error) {
      log.error({ err: error, documentId }, "lecture du document workflow en échec");
      throw error;
    }
  }
  
  /**
   * Supprime un document workflow
   */
  static async deleteWorkflowDocument(documentId: number): Promise<void> {
    try {
      const document = await this.getWorkflowDocument(documentId);
      if (!document) {
        throw new AppError(404, "Document non trouvé");
      }
      
      // Supprimer le fichier physique
      const filePath = existingUploadedFile(document.filePath);
      if (filePath) {
        fs.unlinkSync(filePath);
      }
      
      // Supprimer l'entrée en base
      await db
        .delete(workflowDocuments)
        .where(eq(workflowDocuments.id, documentId));
      
      log.info({ documentId }, "document workflow supprimé");
      
    } catch (error) {
      log.error({ err: error, documentId }, "suppression du document workflow en échec");
      throw error;
    }
  }
  
  /**
   * Nettoie les documents des workflows abandonnés depuis plus de `olderThanDays` jours
   * (7 par défaut). `updatedAt` porte la date de l'abandon (`abandonWorkflow`). Sans cette
   * borne, un workflow abandonné la veille perdait ses documents.
   */
  static async cleanupAbandonedWorkflowDocuments(
    { olderThanDays = 7, now = new Date() }: { olderThanDays?: number; now?: Date } = {},
  ): Promise<void> {
    try {
      const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
      
      // Récupérer les workflows abandonnés
      const abandonedWorkflows = await db
        .select()
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.status, 'abandoned'),
            lt(vehicleAcquisitionWorkflows.updatedAt, cutoff),
          )
        );
      
      for (const workflow of abandonedWorkflows) {
        const documents = await this.getWorkflowDocuments(workflow.sessionId, null, workflow.id);
        
        // Supprimer les documents
        for (const doc of documents) {
          await this.deleteWorkflowDocument(doc.id);
        }
        
        // Le dossier est celui du sessionId, partagé par les workflows homonymes d'autres comptes :
        // il ne part que lorsqu'il ne reste plus aucun document sous ce sessionId.
        const [stillUsed] = await db
          .select({ id: workflowDocuments.id })
          .from(workflowDocuments)
          .where(eq(workflowDocuments.sessionId, workflow.sessionId))
          .limit(1);
        if (stillUsed) continue;

        // Supprimer le dossier du workflow (suppression récursive : jamais hors de uploads/workflows)
        if (!isSafePathSegment(workflow.sessionId)) continue;
        const workflowDir = path.join(process.cwd(), 'uploads', 'workflows', workflow.sessionId);
        if (fs.existsSync(workflowDir)) {
          fs.rmSync(workflowDir, { recursive: true, force: true });
        }
      }
      
      log.info({ count: abandonedWorkflows.length }, "documents des workflows abandonnés nettoyés");
      
    } catch (error) {
      log.error({ err: error }, "nettoyage des documents workflow en échec");
      throw error;
    }
  }
}