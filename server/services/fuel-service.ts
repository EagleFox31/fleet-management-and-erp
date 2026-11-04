import { db } from "../db";
import { fuelRecords, vehicles, type FuelRecord, type InsertFuelRecord } from "@shared/schema";
import { eq, desc, count, sum, avg, and, isNull } from "drizzle-orm";
import { lockFuelCard } from "../lib/fuel-card-lock";
import { AppError } from "../lib/app-error";
import { hasMovedFuelCard } from "../lib/fuel-record-ledger-lock";
import { FUEL_CARD_MANAGER_ROLES } from "@shared/constants/roles";

// Garde historique de DELETE /api/fuel-records/:id (isWorkshopManager), conservée pour un plein physique.
const WORKSHOP_MANAGER_ROLES = ["admin", "workshop_manager"] as const;

/** Année et mois (calendaires) d'une date `AAAA-MM-JJ`, pour les colonnes `year` / `month`. */
function periodOf(date: unknown): { year?: number; month?: number } {
  const match = typeof date === "string" ? /^(\d{4})-(\d{2})-\d{2}/.exec(date) : null;
  return match ? { year: Number(match[1]), month: Number(match[2]) } : {};
}

export class FuelService {
  /**
   * Récupère un enregistrement de carburant par ID - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecord(id: number): Promise<FuelRecord | undefined> {
    const [fuelRecord] = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)));
    return fuelRecord;
  }

  /**
   * Récupère les enregistrements de carburant pour un véhicule - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecordsByVehicleId(vehicleId: number): Promise<any[]> {
    const records = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.vehicleId, vehicleId), isNull(fuelRecords.deletedAt)))
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
    // Écriture sur la carte carburant : sous son verrou, comme les débits et recharges.
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [createdFuelRecord] = await tx
        .insert(fuelRecords)
        .values({
          ...fuelRecord,
          ...periodOf(fuelRecord.date),
          createdBy: createdById,
          updatedBy: createdById,
        })
        .returning();
      return createdFuelRecord;
    });
  }

  /**
   * Met à jour un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async updateFuelRecord(id: number, fuelRecord: Partial<InsertFuelRecord>, updatedById?: number): Promise<FuelRecord | undefined> {
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [updatedFuelRecord] = await tx
        .update(fuelRecords)
        .set({
          ...fuelRecord,
          updatedBy: updatedById,
          updatedAt: new Date(),
        })
        .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)))
        .returning();
      return updatedFuelRecord;
    });
  }

  /**
   * Supprime un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async deleteFuelRecord(id: number, actor: { id: number; role: string }): Promise<boolean> {
    // Supprimer un débit ou une recharge change le solde : même verrou que l'écriture. La décision
    // (ligne vivante ? a-t-elle mouvementé la carte ?) est prise sous ce verrou, dans la transaction.
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [record] = await tx
        .select()
        .from(fuelRecords)
        .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)));
      if (!record) return false;

      if (hasMovedFuelCard(record)) {
        // Plein qui a mouvementé la carte : réservé aux gestionnaires de la carte, suppression douce tracée.
        if (!(FUEL_CARD_MANAGER_ROLES as readonly string[]).includes(actor.role)) {
          throw new AppError(403, "Seuls l'administrateur, la logistique et le secrétariat peuvent supprimer un plein qui a mouvementé la carte carburant.");
        }
        await tx
          .update(fuelRecords)
          .set({ deletedAt: new Date(), deletedBy: actor.id })
          .where(eq(fuelRecords.id, id));
        return true;
      }

      // Plein physique sans mouvement de carte : garde historique (isWorkshopManager), suppression définitive.
      if (!(WORKSHOP_MANAGER_ROLES as readonly string[]).includes(actor.role)) {
        throw new AppError(403, "Accès non autorisé");
      }
      const result = await tx.delete(fuelRecords).where(eq(fuelRecords.id, id)).returning();
      return result.length > 0;
    });
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
      }).from(fuelRecords).where(isNull(fuelRecords.deletedAt));

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