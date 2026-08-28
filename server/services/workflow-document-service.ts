import { db } from "../db";
import { workflowDocuments, vehicleAcquisitionWorkflows } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";

interface WorkflowDocumentData {
  workflowId: number;
  sessionId: string;
  documentType: 'carte_grise' | 'assurance' | 'visite_technique' | 'factur_achat' | 'autre';
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
    try {
      // Générer un nom unique pour le fichier
      const timestamp = Date.now();
      const extension = path.extname(data.originalName);
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
      
      console.log(`📄 Document ${data.documentType} sauvegardé pour le workflow ${data.sessionId}`);
      return document;
      
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde du document workflow:', error);
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
      console.error('❌ Erreur lors de la récupération des documents workflow:', error);
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
        const originalPath = path.join(process.cwd(), doc.filePath.substring(1)); // Retirer le "/" initial
        const newFileName = `${doc.documentType}_${doc.originalName}`;
        const newPath = path.join(vehicleUploadDir, newFileName);
        
        // Copier le fichier
        if (fs.existsSync(originalPath)) {
          fs.copyFileSync(originalPath, newPath);
          
          // Créer l'entrée dans vehicle_documents
          await db.execute(`
            INSERT INTO vehicle_documents (
              vehicle_id, name, type, description, filename, filesize, file_type, file_path, uploaded_by
            ) VALUES (
              ${vehicleId},
              '${doc.originalName}',
              '${doc.documentType}',
              'Document transféré depuis le workflow d''acquisition',
              '${newFileName}',
              ${doc.fileSize},
              '${doc.mimeType}',
              '/uploads/documents/vehicle-${vehicleId}/${newFileName}',
              ${doc.uploadedBy}
            )
          `);
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
      
      console.log(`📁 Documents transférés du workflow ${sessionId} vers le véhicule ${vehicleId}`);
      
    } catch (error) {
      console.error('❌ Erreur lors du transfert des documents:', error);
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
      console.error('❌ Erreur lors de la récupération du document:', error);
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
      const filePath = path.join(process.cwd(), document.filePath.substring(1));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Supprimer l'entrée en base
      await db
        .delete(workflowDocuments)
        .where(eq(workflowDocuments.id, documentId));
      
      console.log(`🗑️ Document workflow ${documentId} supprimé`);
      
    } catch (error) {
      console.error('❌ Erreur lors de la suppression du document:', error);
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
        
        // Supprimer le dossier du workflow
        const workflowDir = path.join(process.cwd(), 'uploads', 'workflows', workflow.sessionId);
        if (fs.existsSync(workflowDir)) {
          fs.rmSync(workflowDir, { recursive: true, force: true });
        }
      }
      
      console.log(`🧹 Nettoyage des documents de ${abandonedWorkflows.length} workflows abandonnés`);
      
    } catch (error) {
      console.error('❌ Erreur lors du nettoyage des documents:', error);
      throw error;
    }
  }
}