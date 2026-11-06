import { db } from '../db';
import { vehicleDocuments } from '@shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { uploadedFileCandidates } from '../lib/uploaded-file';
import { resolveActiveVehicleDocumentTypes } from '../lib/vehicle-document-type';
import { isAppError } from '../lib/app-error';
import { moduleLogger } from '../lib/logger';

const log = moduleLogger('document-management');

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
      log.debug({ vehicleId }, 'aucun document à sauvegarder');
      return;
    }

    log.debug({ vehicleId, count: documents.length }, 'sauvegarde des documents du véhicule');

    // Alias normalisés et codes actifs exigés pour tout le lot, avant la première écriture :
    // un type hors référentiel donne un 400 lisible, pas une violation de clé étrangère.
    const types = await resolveActiveVehicleDocumentTypes(documents.map((doc) => doc.type));

    try {
      for (const [index, doc] of documents.entries()) {
        // Vérifier que le fichier existe
        const fileExists = await this.verifyFileExists(doc.file_path);
        if (!fileExists) {
          // Ni nom ni chemin : saisis par l'utilisateur, ils restent hors du journal.
          log.warn({ vehicleId, index, documentType: types[index] }, 'document ignoré : fichier absent ou hors du dossier des téléversements');
          continue;
        }

        // Insérer le document dans la base
        await db.insert(vehicleDocuments).values({
          vehicleId,
          name: doc.name,
          type: types[index],
          description: doc.description || null,
          filename: doc.filename,
          filesize: doc.filesize,
          fileType: doc.file_type,
          filePath: doc.file_path,
          uploadedBy: uploadedById || null,
          expiryDate: doc.expiry_date || null,
        } as any);

        log.debug({ vehicleId, index, documentType: types[index] }, 'document sauvegardé');
      }

      log.info({ vehicleId, count: documents.length }, 'documents du véhicule traités');
    } catch (error) {
      log.error({ err: error, vehicleId }, 'échec de la sauvegarde des documents');
      // Une AppError (400 lisible) passe telle quelle ; le reste garde sa cause pour le journal.
      if (isAppError(error)) throw error;
      throw new Error('Impossible de sauvegarder les documents', { cause: error });
    }
  }

  /**
   * Vérifie que le fichier existe sous uploads/ : le chemin vient du corps de la
   * requête, un fichier hors du dossier des téléversements n'est jamais rattaché.
   */
  private static async verifyFileExists(filePath: string): Promise<boolean> {
    for (const candidate of uploadedFileCandidates(filePath)) {
      try {
        await fs.access(candidate);
        return true;
      } catch {
        // candidat suivant
      }
    }
    return false;
  }

  /**
   * Traite les documents du workflow et les prépare pour la sauvegarde
   */
  static async processWorkflowDocuments(
    workflowData: any,
    vehicleId: number,
    uploadedById?: number
  ): Promise<void> {
    // Jamais le contenu de workflowData (noms, chemins, données du véhicule) : des compteurs suffisent.
    log.debug({ vehicleId }, 'traitement des documents du workflow');
    if (!workflowData || typeof workflowData !== 'object') return;

    // Extraire les documents des données du workflow
    const documents = this.extractDocumentsFromWorkflowData(workflowData);
    
    if (documents.length === 0) {
      log.debug({ vehicleId }, 'aucun document dans les données du workflow');
      return;
    }

    // Sauvegarder les documents
    await this.saveDocumentsToDatabase(vehicleId, documents, uploadedById);
  }

  /**
   * Types bruts des documents que processWorkflowDocuments écrira, sans effet : la route les vérifie
   * avant de créer le véhicule.
   */
  static workflowDocumentTypes(workflowData: any): unknown[] {
    if (!workflowData || typeof workflowData !== 'object') return [];
    return this.extractDocumentsFromWorkflowData(workflowData).map((doc) => doc?.type);
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

    log.debug({ count: documents.length }, 'documents extraits du workflow');
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
      
      log.debug({ vehicleId, count: docs.length }, 'documents du véhicule lus');
      return docs;
    } catch (error) {
      log.error({ err: error, vehicleId }, 'échec de la lecture des documents du véhicule');
      throw error;
    }
  }
}
