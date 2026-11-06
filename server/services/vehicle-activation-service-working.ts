import { db } from '../db';
import { vehicles, vehicleDocuments, workOrders, statusHistory, activityLogs } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { VehicleDocumentTypeCode } from '@shared/constants/vehicle-document-types';
import fs from 'fs/promises';
import path from 'path';

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
  status: string;
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
  firstMaintenanceDate?: string;
  maintenanceType?: string;
  nextMaintenanceDate?: string;
  nextMaintenanceMileage?: number;
  vehicleId?: number;
}

export class VehicleActivationService {
  /**
   * Active un véhicule depuis un workflow terminé
   */
  static async activateVehicleFromWorkflow(vehicleId: number, workflowData: WorkflowData): Promise<number> {
    console.log('🚛 Activation du véhicule depuis le workflow:', vehicleId);
    
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

      console.log('✅ Véhicule trouvé, ID:', vehicleId);

      // Traiter les documents si présents - utiliser try/catch pour éviter l'échec complet
      if (workflowData.documents) {
        try {
          console.log('📄 Traitement des documents...');
          await this.processDocuments(vehicleId, workflowData.documents, workflowData);
        } catch (error) {
          console.warn('⚠️ Erreur lors du traitement des documents (continuant):', error);
        }
      }

      // Créer la maintenance programmée si nécessaire
      if (workflowData.maintenanceScheduled && workflowData.firstMaintenanceDate) {
        try {
          console.log('🔧 Création de la maintenance...');
          await this.createScheduledMaintenance(vehicleId, workflowData);
        } catch (error) {
          console.warn('⚠️ Erreur lors de la création de la maintenance (continuant):', error);
        }
      }

      // Créer l'entrée dans l'historique des statuts
      try {
        console.log('📊 Création de l\'historique de statut...');
        await this.createStatusHistory(vehicleId, workflowData);
      } catch (error) {
        console.warn('⚠️ Erreur lors de la création de l\'historique (continuant):', error);
      }

      // Log de l'activité
      try {
        console.log('📝 Création du log d\'activité...');
        await this.logActivity(vehicleId, workflowData);
      } catch (error) {
        console.warn('⚠️ Erreur lors du log d\'activité (continuant):', error);
      }

      console.log('🎉 Activation du véhicule terminée avec succès');
      return vehicleId;

    } catch (error) {
      console.error('❌ Erreur critique lors de l\'activation du véhicule:', error);
      throw error;
    }
  }

  /**
   * Traite les documents uploadés
   */
  private static async processDocuments(vehicleId: number, documents: any, workflowData: WorkflowData) {
    console.log('📂 Début du traitement des documents pour véhicule', vehicleId);
    
    // Codes de la graine du référentiel (vérifiés à la compilation) : vehicle_documents.type a une clé étrangère.
    const documentTypes: { key: string; type: VehicleDocumentTypeCode; expiryField: string | null }[] = [
      { key: 'carteGrise', type: 'carte_grise', expiryField: 'licensePlateExpiry' },
      { key: 'assurance', type: 'assurance', expiryField: 'insuranceExpiry' },
      { key: 'visiteTechnique', type: 'visite_technique', expiryField: 'technicalInspectionDate' },
      { key: 'facturAchat', type: 'autre', expiryField: null }
    ];

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
            console.warn(
              `⚠️ Document ${docType.type} ignoré: aucune référence fichier persistée (filePath/filename absents)`,
            );
            continue;
          }

          const resolvedPath = path.isAbsolute(docPath)
            ? docPath
            : path.join(process.cwd(), String(docPath).replace(/^[/\\]+/, ''));

          try {
            await fs.access(resolvedPath);
          } catch {
            console.warn(`⚠️ Document ${docType.type} ignoré: fichier introuvable (${resolvedPath})`);
            continue;
          }

          console.log(`📄 Traitement du document ${docType.type}:`, doc);

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
          console.log(`✅ Document ${docType.type} créé pour le véhicule ${vehicleId}`);
        } catch (error) {
          console.error(`❌ Erreur lors de la création du document ${docType.type}:`, error);
        }
      }
    }

    console.log(`📊 ${documentsProcessed} documents traités au total`);
  }

  /**
   * Crée une maintenance programmée
   */
  private static async createScheduledMaintenance(vehicleId: number, workflowData: WorkflowData) {
    console.log('🔧 Création de la maintenance programmée pour véhicule', vehicleId);

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

    console.log(`✅ Maintenance programmée créée pour le véhicule ${vehicleId}`);
  }

  /**
   * Crée l'entrée dans l'historique des statuts
   */
  private static async createStatusHistory(vehicleId: number, workflowData: WorkflowData) {
    console.log('📊 Création de l\'historique de statut pour véhicule', vehicleId);

    await db.insert(statusHistory).values({
      vehicleId: vehicleId,
      status: (workflowData.status as 'operational' | 'maintenance' | 'out_of_service') || 'operational',
      date: new Date().toISOString().split('T')[0],
      notes: 'Véhicule créé via workflow d\'acquisition',
      updatedById: 1, // Utilisateur système
    });

    console.log(`✅ Historique de statut créé pour le véhicule ${vehicleId}`);
  }

  /**
   * Log de l'activité
   */
  private static async logActivity(vehicleId: number, workflowData: WorkflowData) {
    console.log('📝 Création du log d\'activité pour véhicule', vehicleId);

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

    console.log(`✅ Log d'activité créé pour le véhicule ${vehicleId}`);
  }
}
