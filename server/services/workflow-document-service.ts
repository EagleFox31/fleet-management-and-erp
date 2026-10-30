import { db } from "../db";
import { workflowDocuments, vehicleAcquisitionWorkflows, vehicleDocuments } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isSafePathSegment, uploadedFileCandidates } from "../lib/uploaded-file";

const log = moduleLogger("workflow-documents");

type WorkflowDocumentType = (typeof workflowDocuments.documentType.enumValues)[number];
type VehicleDocumentType = (typeof vehicleDocuments.type.enumValues)[number];

export function isWorkflowDocumentType(value: unknown): value is WorkflowDocumentType {
  return (workflowDocuments.documentType.enumValues as readonly unknown[]).includes(value);
}

/** Type côté véhicule : la facture d'achat n'y a pas de catégorie propre. */
function toVehicleDocumentType(type: WorkflowDocumentType): VehicleDocumentType {
  return type === "factur_achat" ? "autre" : type;
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
      
      // Enregistrer en base de données
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
      }).returning();
      
      log.info({ documentType: data.documentType, sessionId: data.sessionId }, "document workflow sauvegardé");
      return document;

    } catch (error) {
      log.error({ err: error, sessionId: data.sessionId }, "sauvegarde du document workflow en échec");
      throw error;
    }
  }
  
  /**
   * Récupère tous les documents d'un workflow
   */
  static async getWorkflowDocuments(sessionId: string): Promise<any[]> {
    try {
      const documents = await db
        .select()
        .from(workflowDocuments)
        .where(eq(workflowDocuments.sessionId, sessionId))
        .orderBy(workflowDocuments.uploadedAt);
      
      return documents;
    } catch (error) {
      log.error({ err: error, sessionId }, "lecture des documents workflow en échec");
      throw error;
    }
  }
  
  /**
   * Transfère les documents d'un workflow vers un véhicule créé
   */
  static async transferDocumentsToVehicle(sessionId: string, vehicleId: number): Promise<void> {
    try {
      // Récupérer les documents du workflow
      const documents = await this.getWorkflowDocuments(sessionId);
      
      // Copier les fichiers vers le dossier du véhicule
      const vehicleUploadDir = path.join(process.cwd(), 'uploads', 'documents', `vehicle-${vehicleId}`);
      if (!fs.existsSync(vehicleUploadDir)) {
        fs.mkdirSync(vehicleUploadDir, { recursive: true });
      }
      
      for (const doc of documents) {
        const originalPath = existingUploadedFile(doc.filePath);
        // Le nom d'origine vient du client : sans répertoire, il reste dans le dossier du véhicule.
        const newFileName = `${doc.documentType}_${path.basename(doc.originalName)}`;
        const newPath = path.join(vehicleUploadDir, newFileName);

        // Copier le fichier
        if (originalPath) {
          fs.copyFileSync(originalPath, newPath);

          // Créer l'entrée dans vehicle_documents (requête paramétrée : le nom d'origine peut contenir une apostrophe)
          await db.insert(vehicleDocuments).values({
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
        }
      }
      
      // Marquer les documents comme transférés
      await db
        .update(workflowDocuments)
        .set({ 
          vehicleId: vehicleId,
          isTransferred: true 
        })
        .where(eq(workflowDocuments.sessionId, sessionId));
      
      log.info({ sessionId, vehicleId }, "documents workflow transférés au véhicule");

    } catch (error) {
      log.error({ err: error, sessionId, vehicleId }, "transfert des documents workflow en échec");
      throw error;
    }
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
        throw new Error('Document non trouvé');
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
   * Nettoie les documents des workflows abandonnés (plus de 7 jours)
   */
  static async cleanupAbandonedWorkflowDocuments(): Promise<void> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      // Récupérer les workflows abandonnés
      const abandonedWorkflows = await db
        .select()
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.status, 'abandoned'),
            // Workflows abandonnés depuis plus de 7 jours
          )
        );
      
      for (const workflow of abandonedWorkflows) {
        const documents = await this.getWorkflowDocuments(workflow.sessionId);
        
        // Supprimer les documents
        for (const doc of documents) {
          await this.deleteWorkflowDocument(doc.id);
        }
        
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