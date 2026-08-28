import { db } from '../db';
import { sql } from 'drizzle-orm';

interface WorkflowData {
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  vin?: string;
  vehicleType: string;
  tonnage: number;
  axleCount: number;
  engineSpec: string;
  purchaseDate?: string;
  purchasePrice: number;
  fuelType: string;
  status?: string;
  mileage?: number;
  licensePlateExpiry?: string;
  insuranceExpiry?: string;
  technicalInspectionDate?: string;
  notes?: string;
  firstMaintenanceDate?: string;
  maintenanceScheduled?: boolean;
  maintenanceType?: string;
  documents?: any;
}

export class VehicleAutoCreation {
  /**
   * Crée automatiquement un véhicule depuis les données du workflow
   */
  static async createVehicleFromWorkflow(workflowData: WorkflowData): Promise<number> {
    console.log('🚛 Création automatique du véhicule:', workflowData.registrationNumber);
    
    try {
      const result = await db.execute(sql`
        SELECT auto_create_vehicle_from_workflow(
          ${workflowData.registrationNumber},
          ${workflowData.brand},
          ${workflowData.model},
          ${workflowData.year},
          ${workflowData.vin || ''},
          ${workflowData.vehicleType},
          ${workflowData.tonnage},
          ${workflowData.axleCount},
          ${workflowData.engineSpec},
          ${workflowData.purchaseDate ? new Date(workflowData.purchaseDate) : null},
          ${workflowData.purchasePrice},
          ${workflowData.fuelType},
          ${workflowData.status || 'operational'},
          ${workflowData.mileage || 0},
          ${workflowData.licensePlateExpiry ? new Date(workflowData.licensePlateExpiry) : null},
          ${workflowData.insuranceExpiry ? new Date(workflowData.insuranceExpiry) : null},
          ${workflowData.technicalInspectionDate ? new Date(workflowData.technicalInspectionDate) : null},
          ${workflowData.notes || null},
          ${workflowData.firstMaintenanceDate ? new Date(workflowData.firstMaintenanceDate) : null}
        ) AS vehicle_id
      `);
      
      const vehicleId = (result.rows[0] as any).vehicle_id;
      
      if (vehicleId) {
        console.log('✅ Véhicule créé avec succès, ID:', vehicleId);
        
        // Créer la maintenance programmée si nécessaire
        if (workflowData.maintenanceScheduled && workflowData.firstMaintenanceDate) {
          await this.createMaintenanceOrder(vehicleId, workflowData);
        }
        
        // Traiter les documents si présents
        if (workflowData.documents) {
          await this.processDocuments(vehicleId, workflowData.documents, workflowData);
        }
        
        return vehicleId;
      } else {
        throw new Error('Échec de la création du véhicule');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la création automatique:', error);
      throw error;
    }
  }

  /**
   * Crée un ordre de maintenance programmé
   */
  private static async createMaintenanceOrder(vehicleId: number, workflowData: WorkflowData) {
    try {
      await db.execute(sql`
        INSERT INTO work_orders (
          vehicle_id,
          title,
          description,
          priority,
          status,
          scheduled_date,
          work_type,
          estimated_duration,
          created_by
        ) VALUES (
          ${vehicleId},
          'Première maintenance préventive',
          'Maintenance préventive programmée lors de l''acquisition du véhicule',
          'medium',
          'scheduled',
          ${workflowData.firstMaintenanceDate},
          ${workflowData.maintenanceType || 'preventive'},
          240,
          1
        )
      `);
      
      console.log('🔧 Maintenance programmée créée pour le véhicule', vehicleId);
    } catch (error) {
      console.error('❌ Erreur lors de la création de la maintenance:', error);
    }
  }

  /**
   * Traite les documents uploadés
   */
  private static async processDocuments(vehicleId: number, documents: any, workflowData: WorkflowData) {
    try {
      const documentTypes = [
        { key: 'carteGrise', type: 'carte_grise', expiryField: 'licensePlateExpiry' },
        { key: 'assurance', type: 'insurance', expiryField: 'insuranceExpiry' },
        { key: 'visiteTechnique', type: 'visite_technique', expiryField: 'technicalInspectionDate' },
        { key: 'facturAchat', type: 'autre', expiryField: null }
      ];

      for (const docType of documentTypes) {
        if (documents[docType.key]) {
          const doc = documents[docType.key];
          const expiryDate = docType.expiryField ? (workflowData as any)[docType.expiryField] : null;

          await db.execute(sql`
            INSERT INTO vehicle_documents (
              vehicle_id,
              name,
              type,
              description,
              filename,
              filesize,
              file_type,
              file_path,
              uploaded_by,
              expiry_date
            ) VALUES (
              ${vehicleId},
              ${doc.name || `Document ${docType.type}`},
              ${docType.type},
              'Document uploadé via workflow acquisition',
              ${doc.name || `${docType.type}_${vehicleId}`},
              ${doc.size || 0},
              ${doc.type || 'application/octet-stream'},
              ${`/uploads/vehicles/${vehicleId}/${docType.type}_${doc.name || 'document'}`},
              1,
              ${expiryDate ? new Date(expiryDate) : null}
            )
          `);

          console.log(`📄 Document ${docType.type} créé pour le véhicule ${vehicleId}`);
        }
      }
    } catch (error) {
      console.error('❌ Erreur lors du traitement des documents:', error);
    }
  }
}