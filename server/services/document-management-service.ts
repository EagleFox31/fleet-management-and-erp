import { db } from '../db';
import { vehicleDocuments } from '@shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

export interface DocumentData {
  name: string;
  type: string;
  filename: string;
  filesize: number;
  file_type: string;
  file_path: string;
  description?: string;
  expiry_date?: string;
}

export class DocumentManagementService {
  /**
   * Sauvegarde les documents uploadés dans la base de données
   */
  static async saveDocumentsToDatabase(
    vehicleId: number, 
    documents: DocumentData[], 
    uploadedById?: number
  ): Promise<void> {
    if (!documents || documents.length === 0) {
      console.log('Aucun document à sauvegarder pour le véhicule:', vehicleId);
      return;
    }

    console.log(`Sauvegarde de ${documents.length} documents pour le véhicule ${vehicleId}`);

    try {
      for (const doc of documents) {
        // Vérifier que le fichier existe
        const fileExists = await this.verifyFileExists(doc.file_path);
        if (!fileExists) {
          console.warn(`Fichier manquant: ${doc.file_path}`);
          continue;
        }

        // Insérer le document dans la base
        await db.insert(vehicleDocuments).values({
          vehicleId,
          name: doc.name,
          type: doc.type,
          description: doc.description || null,
          filename: doc.filename,
          filesize: doc.filesize,
          fileType: doc.file_type,
          filePath: doc.file_path,
          uploadedBy: uploadedById || null,
          expiryDate: doc.expiry_date || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as any);

        console.log(`Document sauvegardé: ${doc.name} (${doc.type})`);
      }

      console.log(`✅ Tous les documents sauvegardés pour le véhicule ${vehicleId}`);
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des documents:', error);
      throw new Error('Impossible de sauvegarder les documents');
    }
  }

  /**
   * Vérifie qu'un fichier existe sur le disque
   */
  private static async verifyFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Traite les documents du workflow et les prépare pour la sauvegarde
   */
  static async processWorkflowDocuments(
    workflowData: any,
    vehicleId: number,
    uploadedById?: number
  ): Promise<void> {
    console.log('Traitement des documents du workflow pour le véhicule:', vehicleId);
    console.log('Données du workflow reçues:', JSON.stringify(workflowData, null, 2));

    // Extraire les documents des données du workflow
    const documents = this.extractDocumentsFromWorkflowData(workflowData);
    
    if (documents.length === 0) {
      console.log('Aucun document trouvé dans les données du workflow');
      return;
    }

    // Sauvegarder les documents
    await this.saveDocumentsToDatabase(vehicleId, documents, uploadedById);
  }

  /**
   * Extrait les documents des données du workflow
   */
  private static extractDocumentsFromWorkflowData(workflowData: any): DocumentData[] {
    const documents: DocumentData[] = [];

    // Vérifier s'il y a des documents dans le workflow
    if (workflowData.documents && Array.isArray(workflowData.documents)) {
      documents.push(...workflowData.documents);
    }

    // Vérifier les documents par type spécifique
    const documentTypes = [
      'carteGrise',
      'assurance', 
      'visiteTechnique',
      'taxe',
      'autre'
    ];

    for (const docType of documentTypes) {
      if (workflowData[docType] && typeof workflowData[docType] === 'object') {
        const doc = workflowData[docType];
        if (doc.filename && doc.file_path) {
          documents.push({
            name: doc.name || `Document ${docType}`,
            type: this.mapDocumentType(docType),
            filename: doc.filename,
            filesize: doc.filesize || 0,
            file_type: doc.file_type || 'application/octet-stream',
            file_path: doc.file_path,
            description: doc.description,
            expiry_date: doc.expiry_date,
          });
        }
      }
    }

    console.log(`Extracted ${documents.length} documents from workflow data`);
    return documents;
  }

  /**
   * Mappe les types de documents du workflow vers les types de la base
   */
  private static mapDocumentType(workflowType: string): string {
    const mapping: { [key: string]: string } = {
      'carteGrise': 'carte_grise',
      'assurance': 'assurance',
      'visiteTechnique': 'visite_technique',
      'taxe': 'taxe',
      'autre': 'autre'
    };

    return mapping[workflowType] || 'autre';
  }

  /**
   * Récupère tous les documents d'un véhicule
   */
  static async getVehicleDocuments(vehicleId: number) {
    try {
      const docs = await db
        .select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.vehicleId, vehicleId));
      
      console.log(`Trouvé ${docs.length} documents pour le véhicule ${vehicleId}`);
      return docs;
    } catch (error) {
      console.error('Erreur lors de la récupération des documents:', error);
      throw error;
    }
  }
}
