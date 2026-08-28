import { db } from '../db';
import { vehicles, vehicleDocuments, workOrders, statusHistory, activityLogs } from '@shared/schema';
import { eq } from 'drizzle-orm';

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

      // Traiter les documents si présents
      if (workflowData.documents) {
        await this.processDocuments(vehicleId, workflowData.documents, workflowData);
      }

      // Créer la maintenance programmée si nécessaire
      if (workflowData.maintenanceScheduled && workflowData.firstMaintenanceDate) {
        await this.createScheduledMaintenance(vehicleId, workflowData);
      }

      // Créer l'entrée dans l'historique des statuts
      await this.createStatusHistory(vehicleId, workflowData);

      // Log de l'activité
      await this.logActivity(vehicleId, workflowData);

      console.log('🎉 Activation du véhicule terminée');
      return vehicleId;

    } catch (error) {
      console.error('❌ Erreur lors de l\'activation du véhicule:', error);
      throw error;
    }
  }

  /**
   * Traite les documents uploadés
   */
  private static async processDocuments(vehicleId: number, documents: any, workflowData: WorkflowData) {
    try {
      const documentTypes = [
        { key: 'carteGrise', type: 'carte_grise', expiryField: 'licensePlateExpiry' },
        { key: 'assurance', type: 'assurance', expiryField: 'insuranceExpiry' },
        { key: 'visiteTechnique', type: 'visite_technique', expiryField: 'technicalInspectionDate' },
        { key: 'facturAchat', type: 'autre', expiryField: null }
      ];

      for (const docType of documentTypes) {
        if (documents[docType.key]) {
          const doc = documents[docType.key];
          const expiryDate = docType.expiryField ? (workflowData as any)[docType.expiryField] : null;

          await db.insert(vehicleDocuments).values({
            vehicleId: vehicleId,
            name: doc.name || `${docType.type}_${vehicleId}`,
            type: docType.type as any,
            description: `Document ${docType.type} du véhicule`,
            filename: doc.name || `${docType.type}_document`,
            filesize: doc.size || 1024,
            fileType: doc.type || 'application/pdf',
            filePath: `/uploads/vehicles/${vehicleId}/${docType.type}_${doc.name || 'document'}`,
            expiryDate: expiryDate || null,
          });

          console.log(`📄 Document ${docType.type} créé pour le véhicule ${vehicleId}`);
        }
      }
    } catch (error) {
      console.error('❌ Erreur lors du traitement des documents:', error);
      // Ne pas faire échouer toute l'activation pour une erreur de document
    }
  }

  /**
   * Crée une maintenance programmée
   */
  private static async createScheduledMaintenance(vehicleId: number, workflowData: WorkflowData) {
    try {
      await db.insert(workOrders).values({
        vehicleId: vehicleId,
        title: 'Première maintenance préventive',
        description: 'Maintenance préventive programmée lors de l\'acquisition du véhicule',
        priority: 'medium',
        status: 'pending',
        isPreventive: true,
      });

      console.log(`🔧 Maintenance programmée créée pour le véhicule ${vehicleId}`);
    } catch (error) {
      console.error('❌ Erreur lors de la création de la maintenance:', error);
      // Ne pas faire échouer toute l'activation
    }
  }

  /**
   * Crée l'entrée dans l'historique des statuts
   */
  private static async createStatusHistory(vehicleId: number, workflowData: WorkflowData) {
    try {
      await db.insert(statusHistory).values({
        vehicleId,
        status: (workflowData.status as any) || 'operational',
        date: new Date().toISOString().split('T')[0],
        notes: 'Véhicule créé via workflow d\'acquisition',
        updatedById: 1, // Utilisateur système
      });

      console.log(`📊 Historique de statut créé pour le véhicule ${vehicleId}`);
    } catch (error) {
      console.error('❌ Erreur lors de la création de l\'historique:', error);
      // Ne pas faire échouer toute l'activation
    }
  }

  /**
   * Log de l'activité
   */
  private static async logActivity(vehicleId: number, workflowData: WorkflowData) {
    try {
      await db.insert(activityLogs).values({
        userId: 1, // Utilisateur système
        action: 'CREATE',
        entityType: 'vehicle',
        entityId: vehicleId,
        details: {
          source: 'workflow_activation',
          registrationNumber: workflowData.registrationNumber,
          brand: workflowData.brand,
          model: workflowData.model,
        },
      });

      console.log(`📝 Log d'activité créé pour le véhicule ${vehicleId}`);
    } catch (error) {
      console.error('❌ Erreur lors du log d\'activité:', error);
      // Ne pas faire échouer toute l'activation
    }
  }
}