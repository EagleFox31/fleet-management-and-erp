import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface VehicleDeletionResult {
  vehicleId: number;
  registrationNumber: string;
  archived: boolean;
  dependencies: {
    fuelRecords: number;
    maintenanceSchedules: number;
    partRequirements: number;
    statusHistory: number;
    tireRotations: number;
    vehicleDocuments: number;
    vehicleTires: number;
    workOrders: number;
  };
  archiveId?: string;
}

export class VehicleDeletionService {
  /**
   * Archive un véhicule en marquant son statut comme 'out_of_service'
   * et en ajoutant une note d'archivage
   */
  static async archiveVehicle(vehicleId: number, reason?: string): Promise<VehicleDeletionResult> {
    console.log(`🗂️ Archivage du véhicule ID: ${vehicleId}`);
    
    try {
      // 1. Récupérer les informations du véhicule
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
      
      // 2. Compter les dépendances
      const dependencies = await this.countDependencies(vehicleId);
      console.log('📊 Dépendances trouvées:', dependencies);
      
      // 3. Créer l'archive des données
      const archiveId = `ARCH_${Date.now()}_${vehicleId}`;
      await this.createVehicleArchive(vehicleId, archiveId, reason || 'Suppression utilisateur');
      
      // 4. Marquer le véhicule comme hors service avec note d'archivage
      const archiveNote = `ARCHIVÉ LE ${new Date().toISOString().split('T')[0]} - ${reason || 'Suppression utilisateur'}`;
      
      // Mettre à jour directement sans déclencher les triggers
      await db.execute(sql`
        UPDATE vehicles 
        SET 
          status = 'out_of_service',
          notes = COALESCE(notes || E'\n', '') || ${archiveNote}
        WHERE id = ${vehicleId}
      `);
      
      // Ajouter manuellement l'entrée dans l'historique des statuts
      await db.execute(sql`
        INSERT INTO status_history (vehicle_id, status, date, notes)
        VALUES (${vehicleId}, 'out_of_service', CURRENT_DATE, 'Véhicule archivé')
      `);
      
      // 5. Logger l'activité
      await db.execute(sql`
        INSERT INTO activity_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          details
        ) VALUES (
          1,
          'ARCHIVE',
          'vehicle',
          ${vehicleId},
          jsonb_build_object(
            'archive_id', ${archiveId},
            'registration_number', ${vehicle.registration_number},
            'reason', ${reason || 'Suppression utilisateur'},
            'dependencies_count', ${JSON.stringify(dependencies)}
          )
        )
      `);
      
      console.log(`✅ Véhicule ${vehicle.registration_number} archivé avec succès`);
      
      return {
        vehicleId,
        registrationNumber: vehicle.registration_number,
        archived: true,
        dependencies,
        archiveId
      };
      
    } catch (error) {
      console.error(`❌ Erreur lors de l'archivage du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }

  /**
   * Compte les dépendances d'un véhicule
   */
  private static async countDependencies(vehicleId: number) {
    const result = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*) FROM fuel_records WHERE vehicle_id = ${vehicleId}) as fuel_records,
        (SELECT COUNT(*) FROM maintenance_schedules WHERE vehicle_id = ${vehicleId}) as maintenance_schedules,
        (SELECT COUNT(*) FROM part_requirements WHERE vehicle_id = ${vehicleId}) as part_requirements,
        (SELECT COUNT(*) FROM status_history WHERE vehicle_id = ${vehicleId}) as status_history,
        (SELECT COUNT(*) FROM tire_rotations WHERE vehicle_id = ${vehicleId}) as tire_rotations,
        (SELECT COUNT(*) FROM vehicle_documents WHERE vehicle_id = ${vehicleId}) as vehicle_documents,
        (SELECT COUNT(*) FROM vehicle_tires WHERE vehicle_id = ${vehicleId}) as vehicle_tires,
        (SELECT COUNT(*) FROM work_orders WHERE vehicle_id = ${vehicleId}) as work_orders
    `);
    
    const counts = result.rows[0] as any;
    return {
      fuelRecords: parseInt(counts.fuel_records),
      maintenanceSchedules: parseInt(counts.maintenance_schedules),
      partRequirements: parseInt(counts.part_requirements),
      statusHistory: parseInt(counts.status_history),
      tireRotations: parseInt(counts.tire_rotations),
      vehicleDocuments: parseInt(counts.vehicle_documents),
      vehicleTires: parseInt(counts.vehicle_tires),
      workOrders: parseInt(counts.work_orders)
    };
  }

  /**
   * Crée une archive JSON complète du véhicule et de ses données
   */
  private static async createVehicleArchive(vehicleId: number, archiveId: string, reason: string) {
    // Créer une sauvegarde complète dans une table d'archive
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vehicle_archives (
        id SERIAL PRIMARY KEY,
        archive_id TEXT UNIQUE NOT NULL,
        original_vehicle_id INTEGER NOT NULL,
        archived_at TIMESTAMP DEFAULT NOW(),
        archive_reason TEXT,
        vehicle_data JSONB NOT NULL,
        related_data JSONB NOT NULL
      )
    `);
    
    // Sauvegarder les données du véhicule
    const vehicleData = await db.execute(sql`
      SELECT row_to_json(v.*) as vehicle_json
      FROM vehicles v
      WHERE v.id = ${vehicleId}
    `);
    
    // Sauvegarder toutes les données liées
    const relatedData = await db.execute(sql`
      SELECT 
        jsonb_build_object(
          'fuel_records', (
            SELECT COALESCE(jsonb_agg(row_to_json(fr.*)), '[]'::jsonb)
            FROM fuel_records fr WHERE fr.vehicle_id = ${vehicleId}
          ),
          'maintenance_schedules', (
            SELECT COALESCE(jsonb_agg(row_to_json(ms.*)), '[]'::jsonb)
            FROM maintenance_schedules ms WHERE ms.vehicle_id = ${vehicleId}
          ),
          'part_requirements', (
            SELECT COALESCE(jsonb_agg(row_to_json(pr.*)), '[]'::jsonb)
            FROM part_requirements pr WHERE pr.vehicle_id = ${vehicleId}
          ),
          'status_history', (
            SELECT COALESCE(jsonb_agg(row_to_json(sh.*)), '[]'::jsonb)
            FROM status_history sh WHERE sh.vehicle_id = ${vehicleId}
          ),
          'tire_rotations', (
            SELECT COALESCE(jsonb_agg(row_to_json(tr.*)), '[]'::jsonb)
            FROM tire_rotations tr WHERE tr.vehicle_id = ${vehicleId}
          ),
          'vehicle_documents', (
            SELECT COALESCE(jsonb_agg(row_to_json(vd.*)), '[]'::jsonb)
            FROM vehicle_documents vd WHERE vd.vehicle_id = ${vehicleId}
          ),
          'vehicle_tires', (
            SELECT COALESCE(jsonb_agg(row_to_json(vt.*)), '[]'::jsonb)
            FROM vehicle_tires vt WHERE vt.vehicle_id = ${vehicleId}
          ),
          'work_orders', (
            SELECT COALESCE(jsonb_agg(row_to_json(wo.*)), '[]'::jsonb)
            FROM work_orders wo WHERE wo.vehicle_id = ${vehicleId}
          )
        ) as related_json
    `);
    
    // Insérer l'archive
    await db.execute(sql`
      INSERT INTO vehicle_archives (
        archive_id,
        original_vehicle_id,
        archive_reason,
        vehicle_data,
        related_data
      ) VALUES (
        ${archiveId},
        ${vehicleId},
        ${reason},
        ${JSON.stringify((vehicleData.rows[0] as any).vehicle_json)},
        ${(relatedData.rows[0] as any).related_json}
      )
    `);
    
    console.log(`💾 Archive créée: ${archiveId}`);
  }

  /**
   * Restaure un véhicule archivé
   */
  static async restoreVehicle(vehicleId: number): Promise<boolean> {
    console.log(`🔄 Restauration du véhicule ID: ${vehicleId}`);
    
    try {
      // Vérifier que le véhicule existe et récupérer ses notes
      const vehicleCheck = await db.execute(sql`
        SELECT status, notes FROM vehicles WHERE id = ${vehicleId}
      `);
      
      if (vehicleCheck.rows.length === 0) {
        throw new Error(`Véhicule ${vehicleId} introuvable`);
      }
      
      const vehicle = vehicleCheck.rows[0] as any;
      
      // Vérifier que le véhicule est effectivement archivé (contient "ARCHIVÉ" dans les notes)
      if (!vehicle.notes || !vehicle.notes.includes('ARCHIVÉ')) {
        throw new Error(`Le véhicule ${vehicleId} n'est pas archivé`);
      }
      
      // Restaurer le statut du véhicule
      await db.execute(sql`
        UPDATE vehicles 
        SET 
          status = 'operational',
          notes = REGEXP_REPLACE(COALESCE(notes, ''), 'ARCHIVÉ.*', '', 'g')
        WHERE id = ${vehicleId}
      `);
      
      console.log(`✅ Véhicule ${vehicleId} restauré avec succès`);
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur lors de la restauration du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }

  /**
   * Liste les véhicules archivés (ceux qui ont "ARCHIVÉ" dans leurs notes)
   */
  static async getArchivedVehicles() {
    const result = await db.execute(sql`
      SELECT 
        v.id,
        v.registration_number,
        v.brand,
        v.model,
        v.status,
        v.notes,
        va.archive_id,
        va.archive_reason,
        va.archived_at
      FROM vehicles v
      LEFT JOIN vehicle_archives va ON v.id = va.original_vehicle_id
      WHERE v.notes LIKE '%ARCHIVÉ%'
      ORDER BY va.archived_at DESC, v.id DESC
    `);
    
    return result.rows;
  }

  /**
   * Suppression définitive d'un véhicule archivé
   * (uniquement pour les véhicules déjà archivés)
   */
  static async permanentlyDeleteVehicle(vehicleId: number): Promise<boolean> {
    console.log(`🗑️ Suppression définitive du véhicule ID: ${vehicleId}`);
    
    try {
      // Vérifier que le véhicule est archivé
      const vehicleCheck = await db.execute(sql`
        SELECT notes FROM vehicles WHERE id = ${vehicleId}
      `);
      
      if (vehicleCheck.rows.length === 0) {
        throw new Error(`Véhicule ${vehicleId} introuvable`);
      }
      
      const vehicle = vehicleCheck.rows[0] as any;
      if (!vehicle.notes || !vehicle.notes.includes('ARCHIVÉ')) {
        throw new Error(`Le véhicule ${vehicleId} doit être archivé avant suppression définitive`);
      }
      
      // Suppression en cascade respectant les contraintes
      const tables = [
        'fuel_records',
        'maintenance_schedules', 
        'part_requirements',
        'tire_rotations',
        'vehicle_tires',
        'work_orders',
        'vehicle_current_status'
      ];

      // Supprimer les enregistrements liés
      for (const table of tables) {
        try {
          await db.execute(sql`
            DELETE FROM ${sql.identifier(table)}
            WHERE vehicle_id = ${vehicleId}
          `);
          console.log(`🧹 Table ${table} nettoyée`);
        } catch (error) {
          console.warn(`⚠️ Erreur lors du nettoyage de ${table}:`, error);
        }
      }
      
      // Supprimer le véhicule lui-même
      await db.execute(sql`
        DELETE FROM vehicles WHERE id = ${vehicleId}
      `);
      
      console.log(`✅ Véhicule ${vehicleId} supprimé définitivement`);
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur lors de la suppression définitive du véhicule ${vehicleId}:`, error);
      throw error;
    }
  }
}