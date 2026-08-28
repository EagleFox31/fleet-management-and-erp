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
        try {
          await this.processDocuments(vehicleId, workflowData.documents, workflowData);
        } catch (error) {
          console.warn('❌ Erreur lors du traitement des documents:', error);
        }
      }

      // Créer la maintenance programmée si nécessaire
      if (workflowData.maintenanceScheduled && workflowData.firstMaintenanceDate) {
        try {
          await this.createScheduledMaintenance(vehicleId, workflowData);
        } catch (error) {
          console.warn('❌ Erreur lors de la création de la maintenance:', error);
        }
      }

      // Créer l'entrée dans l'historique des statuts
      try {
        await this.createStatusHistory(vehicleId, workflowData);
      } catch (error) {
        console.warn('❌ Erreur lors de la création de l\'historique:', error);
      }

      // Log de l'activité
      try {
        await this.logActivity(vehicleId, workflowData);
      } catch (error) {
        console.warn('❌ Erreur lors du log d\'activité:', error);
      }

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

        // Utiliser les propriétés de schéma correctes
        const documentData = {
          vehicleId: vehicleId,
          name: doc.name || `${docType.type}_${vehicleId}`,
          type: docType.type as 'carte_grise' | 'assurance' | 'visite_technique' | 'taxe' | 'autre',
          description: `Document ${docType.type} du véhicule`,
          filename: doc.name || `${docType.type}_document`,
          filesize: doc.size || 1024,
          fileType: doc.type || 'application/pdf',
          filePath: `/uploads/vehicles/${vehicleId}/${docType.type}_${doc.name || 'document'}`,
          expiryDate: expiryDate || null,
        };

        await db.insert(vehicleDocuments).values(documentData);
        console.log(`📄 Document ${docType.type} créé pour le véhicule ${vehicleId}`);
      }
    }
  }

  /**
   * Crée une maintenance programmée
   */
  private static async createScheduledMaintenance(vehicleId: number, workflowData: WorkflowData) {
    const workOrderData = {
      vehicleId: vehicleId,
      title: 'Première maintenance préventive',
      description: 'Maintenance préventive programmée lors de l\'acquisition du véhicule',
      priority: 'medium' as const,
      status: 'pending' as const,
      isPreventive: true,
    };

    await db.insert(workOrders).values(workOrderData);
    console.log(`🔧 Maintenance programmée créée pour le véhicule ${vehicleId}`);
  }

  /**
   * Crée l'entrée dans l'historique des statuts
   */
  private static async createStatusHistory(vehicleId: number, workflowData: WorkflowData) {
    const statusData = {
      vehicleId: vehicleId,
      status: (workflowData.status as 'operational' | 'maintenance' | 'out_of_service') || 'operational',
      date: new Date().toISOString().split('T')[0],
      notes: 'Véhicule créé via workflow d\'acquisition',
      updatedById: 1, // Utilisateur système
    };

    await db.insert(statusHistory).values(statusData);
    console.log(`📊 Historique de statut créé pour le véhicule ${vehicleId}`);
  }

  /**
   * Log de l'activité
   */
  private static async logActivity(vehicleId: number, workflowData: WorkflowData) {
    const activityData = {
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
    };

    await db.insert(activityLogs).values(activityData);
    console.log(`📝 Log d'activité créé pour le véhicule ${vehicleId}`);
  }
}