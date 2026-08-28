import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface VehicleDeletionResult {
  vehicleId: number;
  registrationNumber: string;
  archived: boolean;
  message: string;
}

export class VehicleDeletionService {
  /**
   * Supprime un véhicule (le trigger se charge automatiquement de l'archivage)
   */
  static async deleteVehicle(vehicleId: number, reason?: string): Promise<VehicleDeletionResult> {
    console.log(`🗑️ Suppression du véhicule ID: ${vehicleId}`);
    
    try {
      // 1. Récupérer les informations du véhicule avant suppression
      const vehicleInfo = await db.execute(sql`
        SELECT id, registration_number, brand, model, status 
        FROM vehicles 
        WHERE id = ${vehicleId}
      `);
      
      if (vehicleInfo.rows.length === 0) {
        throw new Error(`Véhicule avec l'ID ${vehicleId} introuvable`);
      }
      
      const vehicle = vehicleInfo.rows[0] as any;
      console.log(`📋 Véhicule trouvé: ${vehicle.registration_number} (${vehicle.brand} ${vehicle.model})`);
      
      // 2. Mettre à jour la raison d'archivage si fournie
      if (reason) {
        await db.execute(sql`
          UPDATE vehicles 
          SET notes = COALESCE(notes || E'\n', '') || 'Raison suppression: ' || ${reason}
          WHERE id = ${vehicleId}
        `);
      }
      
      // 3. Supprimer le véhicule (le trigger archive automatiquement)
      const deleteResult = await db.execute(sql`
        DELETE FROM vehicles WHERE id = ${vehicleId}
      `);
      
      console.log(`✅ Véhicule ${vehicle.registration_number} supprimé et archivé automatiquement`);
      
      return {
        vehicleId,
        registrationNumber: vehicle.registration_number,
        archived: true,
        message: `Véhicule ${vehicle.registration_number} supprimé et archivé avec succès`
      };
      
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }

  /**
   * Restaure un véhicule depuis les archives
   */
  static async restoreVehicle(vehicleId: number): Promise<boolean> {
    console.log(`🔄 Restauration du véhicule ID: ${vehicleId}`);
    
    try {
      // 1. Récupérer le véhicule archivé
      const archivedVehicle = await db.execute(sql`
        SELECT * FROM vehicle_archived WHERE original_vehicle_id = ${vehicleId}
      `);
      
      if (archivedVehicle.rows.length === 0) {
        throw new Error(`Véhicule archivé avec l'ID ${vehicleId} introuvable`);
      }
      
      const vehicle = archivedVehicle.rows[0] as any;
      
      // 2. Restaurer le véhicule dans la table principale
      await db.execute(sql`
        INSERT INTO vehicles (
          registration_number,
          brand,
          model,
          year,
          vin,
          fuel_type,
          status,
          mileage,
          last_maintenance_date,
          next_maintenance_date,
          insurance_expiry,
          notes,
          created_at
        ) VALUES (
          ${vehicle.registration_number},
          ${vehicle.brand},
          ${vehicle.model},
          ${vehicle.year},
          ${vehicle.vin},
          ${vehicle.fuel_type},
          'operational',
          ${vehicle.mileage},
          ${vehicle.last_maintenance_date},
          ${vehicle.next_maintenance_date},
          ${vehicle.insurance_expiry},
          REGEXP_REPLACE(COALESCE(${vehicle.notes}, ''), 'ARCHIVÉ.*', '', 'g'),
          ${vehicle.created_at}
        )
      `);
      
      // 3. Supprimer de la table d'archive
      await db.execute(sql`
        DELETE FROM vehicle_archived WHERE original_vehicle_id = ${vehicleId}
      `);
      
      // 4. Logger la restauration
      await db.execute(sql`
        INSERT INTO activity_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        ) VALUES (
          1,
          'RESTORE',
          'vehicle',
          ${vehicleId},
          jsonb_build_object(
            'registration_number', ${vehicle.registration_number},
            'restored_from', 'vehicle_archived'
          )
        )
      `);
      
      console.log(`✅ Véhicule ${vehicle.registration_number} restauré avec succès`);
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur lors de la restauration du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }

  /**
   * Liste les véhicules archivés
   */
  static async getArchivedVehicles() {
    const result = await db.execute(sql`
      SELECT 
        original_vehicle_id as id,
        registration_number,
        brand,
        model,
        status,
        archived_at,
        archive_reason,
        notes
      FROM vehicle_archived
      ORDER BY archived_at DESC
    `);
    
    return result.rows;
  }

  /**
   * Suppression définitive d'un véhicule archivé
   */
  static async permanentlyDeleteVehicle(vehicleId: number): Promise<boolean> {
    console.log(`💀 Suppression définitive du véhicule archivé ID: ${vehicleId}`);
    
    try {
      // Supprimer définitivement de la table d'archive
      const deleteResult = await db.execute(sql`
        DELETE FROM vehicle_archived WHERE original_vehicle_id = ${vehicleId}
      `);
      
      if (deleteResult.rowCount === 0) {
        throw new Error(`Véhicule archivé avec l'ID ${vehicleId} introuvable`);
      }
      
      console.log(`✅ Véhicule ${vehicleId} supprimé définitivement`);
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression définitive du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }
}