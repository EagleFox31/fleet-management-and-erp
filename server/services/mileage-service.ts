import { db } from "../db";
import { vehicles, fuelRecords, type Vehicle } from "@shared/schema";
import { and, eq, desc, max, isNull } from "drizzle-orm";

interface MileageHistoryEntry {
  mileage: number;
  date: Date;
  source: "fuel";
  id: number;
}

interface MileageConsistencyIssue {
  type: "decreasing_mileage";
  date: Date;
  source: MileageHistoryEntry["source"];
  mileage: number;
  previousMileage: number;
}

/**
 * Service centralisé pour la gestion automatique du kilométrage des véhicules
 * Responsable de la mise à jour de la colonne last_mileage dans tous les modules
 */
export class MileageService {
  
  /**
   * Met à jour le kilométrage d'un véhicule si le nouveau kilométrage est supérieur
   * @param vehicleId ID du véhicule
   * @param newMileage Nouveau kilométrage
   * @param source Source de la mise à jour (fuel, work_order, tire_rotation, manual)
   * @param sourceId ID de l'enregistrement source
   * @param updatedById ID de l'utilisateur qui fait la mise à jour
   * @returns Le véhicule mis à jour ou undefined si aucune mise à jour
   */
  async updateVehicleMileage(
    vehicleId: number, 
    newMileage: number, 
    source: 'fuel' | 'work_order' | 'tire_rotation' | 'manual' = 'manual',
    sourceId?: number,
    updatedById?: number
  ): Promise<Vehicle | undefined> {
    
    // Récupérer le véhicule actuel
    const [currentVehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));

    if (!currentVehicle) {
      console.error(`Vehicle ${vehicleId} not found`);
      return undefined;
    }

    const currentMileage = Math.max(
      currentVehicle.lastMileage ?? 0,
      currentVehicle.mileage ?? 0,
      currentVehicle.currentKilometers ?? 0
    );

    // Ne mettre à jour que si le nouveau kilométrage est supérieur
    if (newMileage <= currentMileage) {
      console.log(`Mileage ${newMileage} for vehicle ${vehicleId} is not greater than current ${currentMileage}, skipping update`);
      return currentVehicle;
    }

    // Synchroniser tous les champs de kilométrage
    const [updatedVehicle] = await db
      .update(vehicles)
      .set({
        lastMileage: newMileage,
        mileage: newMileage,
        currentKilometers: newMileage,
      })
      .where(eq(vehicles.id, vehicleId))
      .returning();

    console.log(`Vehicle ${vehicleId} mileage updated from ${currentMileage} to ${newMileage} (source: ${source}${sourceId ? `, sourceId: ${sourceId}` : ''})`);

    return updatedVehicle;
  }

  /**
   * Récupère le kilométrage actuel d'un véhicule
   * @param vehicleId ID du véhicule
   * @returns Le kilométrage actuel ou 0 si véhicule non trouvé
   */
  async getCurrentMileage(vehicleId: number): Promise<number> {
    const [vehicle] = await db
      .select({
        lastMileage: vehicles.lastMileage,
        mileage: vehicles.mileage,
        currentKilometers: vehicles.currentKilometers,
      })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));

    if (!vehicle) {
      return 0;
    }

    return Math.max(
      vehicle.lastMileage ?? 0,
      vehicle.mileage ?? 0,
      vehicle.currentKilometers ?? 0
    );
  }

  /**
   * Valide qu'un kilométrage est cohérent (supérieur au kilométrage actuel)
   * @param vehicleId ID du véhicule
   * @param proposedMileage Kilométrage proposé
   * @returns true si valide, false sinon
   */
  async validateMileage(vehicleId: number, proposedMileage: number): Promise<boolean> {
    const currentMileage = await this.getCurrentMileage(vehicleId);
    return proposedMileage >= currentMileage;
  }

  /**
   * Récupère l'historique kilométrique fiable depuis les enregistrements carburant
   * @param vehicleId ID du véhicule
   * @param limit Nombre maximum d'entrées à retourner
   * @returns Historique des kilométrages
   */
  async getMileageHistory(vehicleId: number, limit: number = 50) {
    // Récupérer les kilométrages depuis les pleins de carburant
    const fuelMileages = await db
      .select({
        mileage: fuelRecords.mileage,
        date: fuelRecords.date,
        id: fuelRecords.id
      })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.vehicleId, vehicleId), isNull(fuelRecords.deletedAt)))
      .orderBy(desc(fuelRecords.date));

    // Historique fiable basé sur les enregistrements carburant
    const allMileages: MileageHistoryEntry[] = fuelMileages
      .reduce<MileageHistoryEntry[]>((acc, record) => {
        if (record.mileage == null || record.date == null) {
          return acc;
        }

        const parsedDate = new Date(record.date);
        if (Number.isNaN(parsedDate.getTime())) {
          return acc;
        }

        acc.push({
          mileage: record.mileage,
          date: parsedDate,
          source: "fuel",
          id: record.id
        });
        return acc;
      }, [])
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);

    return allMileages;
  }

  /**
   * Synchronise le kilométrage d'un véhicule en cherchant le plus élevé dans toutes les sources
   * @param vehicleId ID du véhicule
   * @returns Le véhicule mis à jour
   */
  async synchronizeVehicleMileage(vehicleId: number): Promise<Vehicle | undefined> {
    
    // Trouver le kilométrage maximum dans les pleins de carburant
    const [maxFuelMileage] = await db
      .select({ maxMileage: max(fuelRecords.mileage) })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.vehicleId, vehicleId), isNull(fuelRecords.deletedAt)));

    const highestMileage = maxFuelMileage?.maxMileage || 0;

    if (highestMileage > 0) {
      return await this.updateVehicleMileage(vehicleId, highestMileage, 'manual', undefined, undefined);
    }

    return undefined;
  }

  /**
   * Calcule la distance parcourue entre deux kilométrages
   * @param startMileage Kilométrage de début
   * @param endMileage Kilométrage de fin
   * @returns Distance parcourue
   */
  calculateDistance(startMileage: number, endMileage: number): number {
    return Math.max(0, endMileage - startMileage);
  }

  /**
   * Vérifie la cohérence du kilométrage d'un véhicule
   * @param vehicleId ID du véhicule
   * @returns Rapport de cohérence
   */
  async checkMileageConsistency(vehicleId: number) {
    const history = await this.getMileageHistory(vehicleId, 100);
    const currentMileage = await this.getCurrentMileage(vehicleId);
    
    const issues: MileageConsistencyIssue[] = [];
    
    // Vérifier les incohérences dans l'historique
    for (let i = 1; i < history.length; i++) {
      if (history[i].mileage > history[i-1].mileage) {
        issues.push({
          type: 'decreasing_mileage',
          date: history[i].date,
          source: history[i].source,
          mileage: history[i].mileage,
          previousMileage: history[i-1].mileage
        });
      }
    }

    return {
      currentMileage,
      totalRecords: history.length,
      issues,
      isConsistent: issues.length === 0
    };
  }
}

// Instance exportée du service
export const mileageService = new MileageService();
