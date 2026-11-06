import { db } from '../db';
import { vehicles, vehicleDocuments, workOrders, statusHistory, activityLogs } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { VehicleDocumentTypeCode } from '@shared/constants/vehicle-document-types';
import { resolveActiveVehicleDocumentTypes } from '../lib/vehicle-document-type';
import fs from 'fs/promises';
import { uploadedFileCandidates } from '../lib/uploaded-file';
import { moduleLogger } from '../lib/logger';

const log = moduleLogger('vehicle-activation');

interface WorkflowData {
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  vin: string;
  vehicleType: string;
  tonnage: number;
  axleCount: number;
  engineSpec: string;
  purchaseDate: string;
  purchasePrice: number;
  fuelType: string;
  status?: (typeof statusHistory.status.enumValues)[number] | null;
  mileage: number;
  licensePlateExpiry?: string;
  insuranceExpiry?: string;
  technicalInspectionDate?: string;
  notes?: string;
  documents?: {
    carteGrise?: any;
    assurance?: any;
    visiteTechnique?: any;
    facturAchat?: any;
  };
  maintenanceScheduled?: boolean;
  firstMaintenanceDate?: string | null;
  maintenanceType?: string;
  nextMaintenanceDate?: string | null;
  nextMaintenanceMileage?: number | null;
  vehicleId?: number;
}

// Codes de la graine du référentiel (vérifiés à la compilation) : vehicle_documents.type a une clé étrangère,
// et un code peut avoir été désactivé : il est relu actif avant toute écriture.
const ACTIVATION_DOCUMENT_TYPES: readonly { key: string; type: VehicleDocumentTypeCode; expiryField: string | null }[] = [
  { key: 'carteGrise', type: 'carte_grise', expiryField: 'licensePlateExpiry' },
  { key: 'assurance', type: 'assurance', expiryField: 'insuranceExpiry' },
  { key: 'visiteTechnique', type: 'visite_technique', expiryField: 'technicalInspectionDate' },
  { key: 'facturAchat', type: 'autre', expiryField: null }
];

export class VehicleActivationService {
  /**
   * Types que l'activation écrira pour ces documents, sans effet : la route les vérifie
   * avant de créer le véhicule.
   */
  static documentTypeCodes(documents: unknown): VehicleDocumentTypeCode[] {
    // Une liste est lue par DocumentManagementService, pas par l'activation.
    if (!documents || typeof documents !== 'object' || Array.isArray(documents)) return [];
    const present = documents as Record<string, unknown>;
    return ACTIVATION_DOCUMENT_TYPES.filter((d) => present[d.key]).map((d) => d.type);
  }

  /**
   * Active un véhicule depuis un workflow terminé
   */
  static async activateVehicleFromWorkflow(vehicleId: number, workflowData: WorkflowData): Promise<number> {
    log.info({ vehicleId }, 'activation du véhicule depuis le workflow');
    
    try {
      // Vérifier si le véhicule existe
      const existingVehicle = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .limit(1);

      if (existingVehicle.length === 0) {
        throw new Error(`Véhicule avec ID ${vehicleId} non trouvé`);
      }

      log.debug({ vehicleId }, 'véhicule trouvé');

      // Traiter les documents si présents - utiliser try/catch pour éviter l'échec complet
      if (workflowData.documents) {
        try {
          log.debug({ vehicleId }, 'activation : traitement des documents');
          await this.processDocuments(vehicleId, workflowData.documents, workflowData);
        } catch (error) {
          log.warn({ err: error, vehicleId }, 'activation : documents non traités, activation poursuivie');
        }
      }

      // Créer la maintenance programmée si nécessaire
      if (workflowData.maintenanceScheduled && workflowData.firstMaintenanceDate) {
        try {
          log.debug({ vehicleId }, 'activation : création de la maintenance');
          await this.createScheduledMaintenance(vehicleId, workflowData);
        } catch (error) {
          log.warn({ err: error, vehicleId }, 'activation : maintenance non programmée, activation poursuivie');
        }
      }

      // Créer l'entrée dans l'historique des statuts
      try {
        log.debug({ vehicleId }, "activation : création de l'historique de statut");
        await this.createStatusHistory(vehicleId, workflowData);
      } catch (error) {
        log.warn({ err: error, vehicleId }, 'activation : historique de statut non écrit, activation poursuivie');
      }

      // Log de l'activité
      try {
        log.debug({ vehicleId }, "activation : création du journal d'activité");
        await this.logActivity(vehicleId, workflowData);
      } catch (error) {
        log.warn({ err: error, vehicleId }, "activation : journal d'activité non écrit, activation poursuivie");
      }

      log.info({ vehicleId }, 'activation du véhicule terminée');
      return vehicleId;

    } catch (error) {
      log.error({ err: error, vehicleId }, "échec de l'activation du véhicule");
      throw error;
    }
  }

  /**
   * Traite les documents uploadés
   */
  private static async processDocuments(vehicleId: number, documents: any, workflowData: WorkflowData) {
    log.debug({ vehicleId }, 'début du traitement des documents');
    
    // Codes actifs exigés avant la première écriture, jamais une violation de clé étrangère. La route les a
    // vérifiés avant de créer le véhicule ; un code désactivé entre-temps lève ici, sans aucun document écrit.
    const documentTypes = ACTIVATION_DOCUMENT_TYPES.filter((d) => documents[d.key]);
    await resolveActiveVehicleDocumentTypes(documentTypes.map((d) => d.type));

    let documentsProcessed = 0;

    for (const docType of documentTypes) {
      if (documents[docType.key]) {
        try {
          const doc = documents[docType.key];
          const expiryDate = docType.expiryField ? (workflowData as any)[docType.expiryField] : null;
          const docPath = doc?.filePath || doc?.file_path;
          const docFilename = doc?.filename || doc?.originalName || doc?.name;

          // Ne plus créer de placeholders non téléchargeables: on insère uniquement des fichiers réellement stockés.
          if (!docPath || !docFilename) {
            log.warn({ vehicleId, documentType: docType.type }, 'document ignoré : aucune référence de fichier enregistrée');
            continue;
          }

          // Le chemin vient du corps de la requête : seul un fichier existant sous uploads/ est rattaché
          // (un « ../.env » n'est jamais enregistré dans vehicle_documents.filePath).
          if (!(await this.uploadedFileExists(String(docPath)))) {
            log.warn({ vehicleId, documentType: docType.type }, 'document ignoré : fichier absent ou hors du dossier des téléversements');
            continue;
          }

          // Type seulement : le document porte des noms et un chemin saisis par l'utilisateur.
          log.debug({ vehicleId, documentType: docType.type }, "traitement d'un document d'activation");

          await db.insert(vehicleDocuments).values({
            vehicleId: vehicleId,
            name: doc.name || `${docType.type}_${vehicleId}`,
            type: docType.type,
            description: `Document ${docType.type} du véhicule`,
            filename: docFilename,
            filesize: doc.size || doc.filesize || 0,
            fileType: doc.type || doc.file_type || 'application/octet-stream',
            filePath: docPath,
            expiryDate: expiryDate || null,
          });

          documentsProcessed++;
          log.debug({ vehicleId, documentType: docType.type }, "document d'activation créé");
        } catch (error) {
          log.error({ err: error, vehicleId, documentType: docType.type }, "échec de l'écriture d'un document d'activation");
        }
      }
    }

    log.info({ vehicleId, documentsProcessed }, "documents d'activation traités");
  }

  /** Fichier existant sous uploads/ (liens résolus) : tout autre chemin est refusé. */
  private static async uploadedFileExists(storedPath: string): Promise<boolean> {
    for (const candidate of uploadedFileCandidates(storedPath)) {
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
   * Crée une maintenance programmée
   */
  private static async createScheduledMaintenance(vehicleId: number, workflowData: WorkflowData) {
    log.debug({ vehicleId }, 'création de la maintenance programmée');

    const plannedDate = workflowData.firstMaintenanceDate
      ? new Date(`${workflowData.firstMaintenanceDate}T00:00:00`)
      : new Date();

    await db.insert(workOrders).values({
      vehicleId: vehicleId,
      title: 'Première maintenance préventive',
      description: 'Maintenance préventive programmée lors de l\'acquisition du véhicule',
      priority: 'medium' as const,
      status: 'pending' as const,
      startDate: plannedDate,
      isPreventive: true,
    });

    // Garder la fiche véhicule alignée avec la maintenance programmée du workflow
    await db
      .update(vehicles)
      .set({
        nextMaintenanceDate: workflowData.firstMaintenanceDate || workflowData.nextMaintenanceDate || null,
        nextMaintenanceMileage: workflowData.nextMaintenanceMileage || null,
      })
      .where(eq(vehicles.id, vehicleId));

    log.info({ vehicleId }, 'maintenance programmée créée');
  }

  /**
   * Crée l'entrée dans l'historique des statuts
   */
  private static async createStatusHistory(vehicleId: number, workflowData: WorkflowData) {
    log.debug({ vehicleId }, "création de l'historique de statut");

    await db.insert(statusHistory).values({
      vehicleId: vehicleId,
      // Valeur bornée en amont par activationWorkflowDataSchema (énumération de status_history).
      status: workflowData.status || 'operational',
      date: new Date().toISOString().split('T')[0],
      notes: 'Véhicule créé via workflow d\'acquisition',
      updatedById: 1, // Utilisateur système
    });

    log.debug({ vehicleId }, 'historique de statut créé');
  }

  /**
   * Log de l'activité
   */
  private static async logActivity(vehicleId: number, workflowData: WorkflowData) {
    log.debug({ vehicleId }, "création du journal d'activité");

    await db.insert(activityLogs).values({
      userId: 1, // Utilisateur système
      action: 'CREATE' as const,
      entityType: 'vehicle' as const,
      entityId: vehicleId,
      details: {
        source: 'workflow_activation',
        registrationNumber: workflowData.registrationNumber,
        brand: workflowData.brand,
        model: workflowData.model,
      },
    });

    log.debug({ vehicleId }, "journal d'activité créé");
  }
}
