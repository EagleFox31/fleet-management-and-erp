import { db } from "../db";
import { fuelRecords, vehicles, type FuelRecord, type InsertFuelRecord } from "@shared/schema";
import { eq, desc, count, sum, avg } from "drizzle-orm";

export class FuelService {
  /**
   * Récupère un enregistrement de carburant par ID - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecord(id: number): Promise<FuelRecord | undefined> {
    const [fuelRecord] = await db
      .select()
      .from(fuelRecords)
      .where(eq(fuelRecords.id, id));
    return fuelRecord;
  }

  /**
   * Récupère les enregistrements de carburant pour un véhicule - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecordsByVehicleId(vehicleId: number): Promise<any[]> {
    const records = await db
      .select()
      .from(fuelRecords)
      .where(eq(fuelRecords.vehicleId, vehicleId))
      .orderBy(desc(fuelRecords.date));
    
    // Enrichir avec le prix par litre calculé
    return records.map(record => ({
      ...record,
      pricePerLiter: record.quantity > 0 ? Number(record.cost) / record.quantity : 0,
      totalCost: Number(record.cost)
    }));
  }

  /**
   * Crée un nouvel enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async createFuelRecord(fuelRecord: InsertFuelRecord, createdById?: number): Promise<FuelRecord> {
    const [createdFuelRecord] = await db
      .insert(fuelRecords)
      .values({
        ...fuelRecord,
        createdBy: createdById,
        updatedBy: createdById,
      })
      .returning();
    return createdFuelRecord;
  }

  /**
   * Met à jour un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async updateFuelRecord(id: number, fuelRecord: Partial<InsertFuelRecord>, updatedById?: number): Promise<FuelRecord | undefined> {
    const [updatedFuelRecord] = await db
      .update(fuelRecords)
      .set({
        ...fuelRecord,
        updatedBy: updatedById,
        updatedAt: new Date(),
      })
      .where(eq(fuelRecords.id, id))
      .returning();
    return updatedFuelRecord;
  }

  /**
   * Supprime un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async deleteFuelRecord(id: number): Promise<boolean> {
    const result = await db
      .delete(fuelRecords)
      .where(eq(fuelRecords.id, id))
      .returning();
    return result.length > 0;
  }

  /**
   * Récupère les statistiques globales de carburant
   */
  async getFuelStatistics() {
    try {
      const [stats] = await db.select({
        totalCost: sum(fuelRecords.cost),
        totalQuantity: sum(fuelRecords.quantity),
        recordsCount: count(fuelRecords.id),
        averageCost: avg(fuelRecords.cost)
      }).from(fuelRecords);

      return {
        totalCost: Number(stats.totalCost || 0),
        totalQuantity: Number(stats.totalQuantity || 0),
        recordsCount: Number(stats.recordsCount || 0),
        averageCost: Number(stats.averageCost || 0)
      };
    } catch (error) {
      console.error('Error getting fuel statistics:', error);
      return {
        totalCost: 0,
        totalQuantity: 0,
        recordsCount: 0,
        averageCost: 0
      };
    }
  }
}