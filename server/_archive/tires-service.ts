import { db } from "../db";
import { tires, vehicleTires, tireInspections, tireRotations, vehicles } from "@shared/schema";
import { eq, desc, and, sql, gte, lte, or, like, isNull } from "drizzle-orm";
import type { Tire, InsertTire, VehicleTire, InsertVehicleTire, TireInspection, InsertTireInspection, TireRotation, InsertTireRotation } from "@shared/schema";

export class TiresService {
  // CRUD Operations for Tires
  async getTire(id: number): Promise<Tire | undefined> {
    try {
      const [tire] = await db
        .select()
        .from(tires)
        .where(eq(tires.id, id));
      return tire || undefined;
    } catch (error) {
      console.error('Error getting tire:', error);
      return undefined;
    }
  }

  async getTires(filters?: {
    brand?: string;
    model?: string;
    size?: string;
    status?: string;
    location?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tires: Tire[]; total: number }> {
    try {
      console.log('getTires called - fetching from PostgreSQL...');
      
      const conditions = [];
      
      // Apply filters
      if (filters?.brand) {
        conditions.push(like(tires.brand, `%${filters.brand}%`));
      }
      
      if (filters?.model) {
        conditions.push(like(tires.model, `%${filters.model}%`));
      }
      
      if (filters?.size) {
        conditions.push(like(tires.size, `%${filters.size}%`));
      }
      
      if (filters?.location) {
        conditions.push(like(tires.location, `%${filters.location}%`));
      }
      
      // Build base query
      const whereClause = conditions.length > 0 
        ? (conditions.length === 1 ? conditions[0] : and(...conditions))
        : undefined;
      
      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(tires)
        .where(whereClause);
      
      const total = countResult[0]?.count || 0;
      
      // Get paginated results
      let query = db
        .select()
        .from(tires)
        .orderBy(desc(tires.createdAt));
      
      if (whereClause) {
        query = query.where(whereClause);
      }
      
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      
      if (filters?.offset) {
        query = query.offset(filters.offset);
      }
      
      const tiresResult = await query;
      
      console.log(`Tires retrieved from DB: ${tiresResult.length} items, total: ${total}`);
      
      return {
        tires: tiresResult,
        total
      };
    } catch (error) {
      console.error('Error getting tires:', error);
      return { tires: [], total: 0 };
    }
  }

  async createTire(tire: InsertTire): Promise<Tire> {
    try {
      const [newTire] = await db
        .insert(tires)
        .values(tire)
        .returning();
      
      console.log(`✅ New tire created: ${newTire.brand} ${newTire.model} - ${newTire.size}`);
      
      return newTire;
    } catch (error) {
      console.error('Error creating tire:', error);
      throw new Error('Erreur lors de la création du pneu');
    }
  }

  async updateTire(id: number, tire: Partial<InsertTire>): Promise<Tire | undefined> {
    try {
      const [updatedTire] = await db
        .update(tires)
        .set({
          ...tire,
          updatedAt: new Date()
        })
        .where(eq(tires.id, id))
        .returning();
      
      console.log(`✅ Tire updated: ID ${id}`);
      
      return updatedTire;
    } catch (error) {
      console.error('Error updating tire:', error);
      return undefined;
    }
  }

  async deleteTire(id: number): Promise<boolean> {
    try {
      // Vérifier si le pneu est installé sur un véhicule
      const [vehicleTire] = await db
        .select()
        .from(vehicleTires)
        .where(and(
          eq(vehicleTires.tireId, id),
          eq(vehicleTires.status, 'active')
        ));
      
      if (vehicleTire) {
        throw new Error('Impossible de supprimer un pneu installé sur un véhicule');
      }
      
      await db.delete(tires).where(eq(tires.id, id));
      
      console.log(`✅ Tire deleted: ID ${id}`);
      
      return true;
    } catch (error) {
      console.error('Error deleting tire:', error);
      return false;
    }
  }

  // Vehicle Tires Management
  async getVehicleTires(vehicleId: number): Promise<Array<VehicleTire & { tire: Tire; vehicle: any }>> {
    try {
      console.log('getVehicleTires called - using PostgreSQL methods');
      
      const result = await db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          tireId: vehicleTires.tireId,
          position: vehicleTires.position,
          installationDate: vehicleTires.installationDate,
          installationMileage: vehicleTires.installationMileage,
          currentTreadDepth: vehicleTires.currentTreadDepth,
          initialTreadDepth: vehicleTires.initialTreadDepth,
          currentPressure: vehicleTires.currentPressure,
          recommendedPressure: vehicleTires.recommendedPressure,
          status: vehicleTires.status,
          removalDate: vehicleTires.removalDate,
          removalMileage: vehicleTires.removalMileage,
          removalReason: vehicleTires.removalReason,
          notes: vehicleTires.notes,
          createdAt: vehicleTires.createdAt,
          updatedAt: vehicleTires.updatedAt,
          // Tire details
          tire: {
            id: tires.id,
            brand: tires.brand,
            model: tires.model,
            size: tires.size,
            tireType: tires.tireType,
            dotCode: tires.dotCode,
            manufactureDate: tires.manufactureDate,
            supplier: tires.supplier,
            purchasePrice: tires.purchasePrice,
            warrantyMonths: tires.warrantyMonths,
            maxLoadIndex: tires.maxLoadIndex,
            speedRating: tires.speedRating,
            stockQuantity: tires.stockQuantity,
            minStockLevel: tires.minStockLevel,
            location: tires.location,
            notes: tires.notes,
            createdAt: tires.createdAt,
            updatedAt: tires.updatedAt
          },
          // Vehicle details
          vehicle: {
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            brand: vehicles.brand,
            model: vehicles.model
          }
        })
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .where(eq(vehicleTires.vehicleId, vehicleId))
        .orderBy(desc(vehicleTires.installationDate));
      
      return result as any;
    } catch (error) {
      console.error('Error getting vehicle tires:', error);
      return [];
    }
  }

  async getAllVehicleTires(): Promise<Array<VehicleTire & { tire: Tire; vehicle: any }>> {
    try {
      console.log("getAllVehicleTires called - using PostgreSQL methods");

      const result = await db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          tireId: vehicleTires.tireId,
          position: vehicleTires.position,
          installationDate: vehicleTires.installationDate,
          installationMileage: vehicleTires.installationMileage,
          currentTreadDepth: vehicleTires.currentTreadDepth,
          initialTreadDepth: vehicleTires.initialTreadDepth,
          currentPressure: vehicleTires.currentPressure,
          recommendedPressure: vehicleTires.recommendedPressure,
          status: vehicleTires.status,
          removalDate: vehicleTires.removalDate,
          removalMileage: vehicleTires.removalMileage,
          removalReason: vehicleTires.removalReason,
          notes: vehicleTires.notes,
          createdAt: vehicleTires.createdAt,
          updatedAt: vehicleTires.updatedAt,
          tire: {
            id: tires.id,
            brand: tires.brand,
            model: tires.model,
            size: tires.size,
            tireType: tires.tireType,
            dotCode: tires.dotCode,
            manufactureDate: tires.manufactureDate,
            supplier: tires.supplier,
            purchasePrice: tires.purchasePrice,
            warrantyMonths: tires.warrantyMonths,
            maxLoadIndex: tires.maxLoadIndex,
            speedRating: tires.speedRating,
            stockQuantity: tires.stockQuantity,
            minStockLevel: tires.minStockLevel,
            location: tires.location,
            notes: tires.notes,
            createdAt: tires.createdAt,
            updatedAt: tires.updatedAt
          },
          vehicle: {
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            brand: vehicles.brand,
            model: vehicles.model
          }
        })
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
        .orderBy(desc(vehicleTires.installationDate));

      return result as any;
    } catch (error) {
      console.error("Error getting all vehicle tires:", error);
      return [];
    }
  }

  async installTireOnVehicle(data: InsertVehicleTire): Promise<VehicleTire> {
    try {
      // Mettre à jour le statut du pneu
      await db
        .update(tires)
        .set({ status: 'installed' })
        .where(eq(tires.id, data.tireId));
      
      const [installation] = await db
        .insert(vehicleTires)
        .values({
          ...data,
          installedAt: new Date()
        })
        .returning();
      
      console.log(`✅ Tire installed: Tire ${data.tireId} on vehicle ${data.vehicleId} at position ${data.position}`);
      
      return installation;
    } catch (error) {
      console.error('Error installing tire:', error);
      throw new Error('Erreur lors de l\'installation du pneu');
    }
  }

  async updateVehicleTire(id: number, data: Partial<InsertVehicleTire>): Promise<VehicleTire | undefined> {
    try {
      const [updated] = await db
        .update(vehicleTires)
        .set(data)
        .where(eq(vehicleTires.id, id))
        .returning();
      
      return updated;
    } catch (error) {
      console.error('Error updating vehicle tire:', error);
      return undefined;
    }
  }

  async removeTireFromVehicle(vehicleTireId: number, mileageAtRemoval?: number): Promise<boolean> {
    try {
      // Récupérer les détails de l'installation
      const [vehicleTire] = await db
        .select()
        .from(vehicleTires)
        .where(eq(vehicleTires.id, vehicleTireId));
      
      if (!vehicleTire) {
        return false;
      }
      
      // Marquer comme retiré
      await db
        .update(vehicleTires)
        .set({
          removedAt: new Date(),
          mileageAtRemoval
        })
        .where(eq(vehicleTires.id, vehicleTireId));
      
      // Mettre à jour le statut du pneu
      await db
        .update(tires)
        .set({ status: 'available' })
        .where(eq(tires.id, vehicleTire.tireId));
      
      console.log(`✅ Tire removed: Vehicle tire ${vehicleTireId}`);
      
      return true;
    } catch (error) {
      console.error('Error removing tire:', error);
      return false;
    }
  }

  // Tire Inspections
  async getTireInspections(filters?: {
    vehicleId?: number;
    tireId?: number;
    limit?: number;
    offset?: number;
  }): Promise<Array<TireInspection & { vehicle?: any; tire?: Tire }>> {
    try {
      console.log('getTireInspections called - using PostgreSQL methods');
      
      let query = db
        .select({
          id: tireInspections.id,
          vehicleId: tireInspections.vehicleId,
          tireId: tireInspections.tireId,
          inspectionDate: tireInspections.inspectionDate,
          position: tireInspections.position,
          treadDepth: tireInspections.treadDepth,
          pressure: tireInspections.pressure,
          condition: tireInspections.condition,
          notes: tireInspections.notes,
          inspectorId: tireInspections.inspectorId,
          createdAt: tireInspections.createdAt,
          // Vehicle details
          vehicle: {
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            brand: vehicles.brand,
            model: vehicles.model
          },
          // Tire details
          tire: {
            id: tires.id,
            brand: tires.brand,
            model: tires.model,
            size: tires.size,
            dotCode: tires.dotCode
          }
        })
        .from(tireInspections)
        .leftJoin(vehicles, eq(tireInspections.vehicleId, vehicles.id))
        .leftJoin(tires, eq(tireInspections.tireId, tires.id));
      
      // Apply filters
      const conditions = [];
      
      if (filters?.vehicleId) {
        conditions.push(eq(tireInspections.vehicleId, filters.vehicleId));
      }
      
      if (filters?.tireId) {
        conditions.push(eq(tireInspections.tireId, filters.tireId));
      }
      
      if (conditions.length > 0) {
        const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
        query = query.where(whereClause);
      }
      
      // Apply pagination
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }
      
      if (filters?.offset) {
        query = query.offset(filters.offset);
      }
      
      // Order by inspection date
      query = query.orderBy(desc(tireInspections.inspectionDate));
      
      const result = await query;
      
      return result.map(row => ({
        ...row,
        vehicle: row.vehicle,
        tire: row.tire
      }));
    } catch (error) {
      console.error('Error getting tire inspections:', error);
      return [];
    }
  }

  async getVehicleTire(vehicleId: number, position: string): Promise<(VehicleTire & { tire: Tire }) | undefined> {
    try {
      const [result] = await db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          tireId: vehicleTires.tireId,
          position: vehicleTires.position,
          installedAt: vehicleTires.installedAt,
          removedAt: vehicleTires.removedAt,
          mileageAtInstallation: vehicleTires.mileageAtInstallation,
          mileageAtRemoval: vehicleTires.mileageAtRemoval,
          tire: {
            id: tires.id,
            brand: tires.brand,
            model: tires.model,
            size: tires.size,
            dotCode: tires.dotCode,
            status: tires.status,
            purchaseDate: tires.purchaseDate,
            purchasePrice: tires.purchasePrice,
            supplier: tires.supplier,
            location: tires.location,
            treadDepth: tires.treadDepth,
            pressure: tires.pressure,
            notes: tires.notes,
            createdAt: tires.createdAt,
            updatedAt: tires.updatedAt
          }
        })
        .from(vehicleTires)
        .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
        .where(and(
          eq(vehicleTires.vehicleId, vehicleId),
          eq(vehicleTires.position, position),
          isNull(vehicleTires.removedAt)
        ));
      
      return result ? { ...result, tire: result.tire } : undefined;
    } catch (error) {
      console.error('Error getting vehicle tire:', error);
      return undefined;
    }
  }

  async createTireInspection(inspection: InsertTireInspection): Promise<TireInspection> {
    try {
      const [newInspection] = await db
        .insert(tireInspections)
        .values(inspection)
        .returning();
      
      console.log(`✅ Tire inspection created for vehicle ${inspection.vehicleId}`);
      
      return newInspection;
    } catch (error) {
      console.error('Error creating tire inspection:', error);
      throw new Error('Erreur lors de la création de l\'inspection');
    }
  }

  async getLastInspection(vehicleId: number, position: string): Promise<TireInspection | undefined> {
    try {
      const [lastInspection] = await db
        .select()
        .from(tireInspections)
        .where(and(
          eq(tireInspections.vehicleId, vehicleId),
          eq(tireInspections.position, position)
        ))
        .orderBy(desc(tireInspections.inspectionDate))
        .limit(1);
      
      return lastInspection || undefined;
    } catch (error) {
      console.error('Error getting last inspection:', error);
      return undefined;
    }
  }

  // Tire Rotations
  async getTireRotations(vehicleId?: number): Promise<Array<TireRotation & { vehicle?: any }>> {
    try {
      console.log('getTireRotations called - using PostgreSQL methods');
      
      let query = db
        .select({
          id: tireRotations.id,
          vehicleId: tireRotations.vehicleId,
          rotationDate: tireRotations.rotationDate,
          fromPositions: tireRotations.fromPositions,
          toPositions: tireRotations.toPositions,
          mileage: tireRotations.mileage,
          reason: tireRotations.reason,
          notes: tireRotations.notes,
          performedBy: tireRotations.performedBy,
          createdAt: tireRotations.createdAt,
          // Vehicle details
          vehicle: {
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            brand: vehicles.brand,
            model: vehicles.model
          }
        })
        .from(tireRotations)
        .leftJoin(vehicles, eq(tireRotations.vehicleId, vehicles.id));
      
      if (vehicleId) {
        query = query.where(eq(tireRotations.vehicleId, vehicleId));
      }
      
      query = query.orderBy(desc(tireRotations.rotationDate));
      
      const result = await query;
      
      return result.map(row => ({
        ...row,
        vehicle: row.vehicle
      }));
    } catch (error) {
      console.error('Error getting tire rotations:', error);
      return [];
    }
  }

  async createTireRotation(rotation: InsertTireRotation): Promise<TireRotation> {
    try {
      const [newRotation] = await db
        .insert(tireRotations)
        .values(rotation)
        .returning();
      
      console.log(`✅ Tire rotation created for vehicle ${rotation.vehicleId}`);
      
      return newRotation;
    } catch (error) {
      console.error('Error creating tire rotation:', error);
      throw new Error('Erreur lors de la création de la permutation');
    }
  }

  async getTireRotationDetails(rotationId: number): Promise<(TireRotation & { vehicle?: any }) | undefined> {
    try {
      const [result] = await db
        .select({
          id: tireRotations.id,
          vehicleId: tireRotations.vehicleId,
          rotationDate: tireRotations.rotationDate,
          fromPositions: tireRotations.fromPositions,
          toPositions: tireRotations.toPositions,
          mileage: tireRotations.mileage,
          reason: tireRotations.reason,
          notes: tireRotations.notes,
          performedBy: tireRotations.performedBy,
          createdAt: tireRotations.createdAt,
          // Vehicle details
          vehicle: {
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            brand: vehicles.brand,
            model: vehicles.model
          }
        })
        .from(tireRotations)
        .leftJoin(vehicles, eq(tireRotations.vehicleId, vehicles.id))
        .where(eq(tireRotations.id, rotationId));
      
      return result ? { ...result, vehicle: result.vehicle } : undefined;
    } catch (error) {
      console.error('Error getting tire rotation details:', error);
      return undefined;
    }
  }

  // Statistics and Monitoring
  async getTireStatistics(): Promise<{
    totalTires: string;
    totalValue: string;
    lowTreadCount: string;
    availableCount: string;
  }> {
    try {
      console.log('getTireStatistics called - using PostgreSQL methods');
      
      // Statistiques générales
      const [stats] = await db
        .select({
          totalTires: sql<number>`count(*)`,
          totalValue: sql<number>`sum(case when ${tires.purchasePrice} is not null then ${tires.purchasePrice} else 0 end)`,
          lowTreadCount: sql<number>`count(case when ${tires.treadDepth} < 3 then 1 end)`,
          availableCount: sql<number>`count(case when ${tires.status} = 'available' then 1 end)`
        })
        .from(tires);
      
      return {
        totalTires: (stats.totalTires || 0).toString(),
        totalValue: (stats.totalValue || 0).toString(),
        lowTreadCount: (stats.lowTreadCount || 0).toString(),
        availableCount: (stats.availableCount || 0).toString()
      };
    } catch (error) {
      console.error('Error calculating tire statistics:', error);
      return {
        totalTires: '0',
        totalValue: '0',
        lowTreadCount: '0',
        availableCount: '0'
      };
    }
  }

  async getLowStockTires(): Promise<Tire[]> {
    try {
      console.log('getLowStockTires called - using PostgreSQL methods');
      
      const lowTreadTires = await db
        .select()
        .from(tires)
        .where(or(
          lte(tires.treadDepth, 3), // Profondeur de sculpture faible
          eq(tires.status, 'worn_out') // Statut usé
        ))
        .orderBy(tires.treadDepth);
      
      console.log(`Found ${lowTreadTires.length} tires with low tread or worn out`);
      
      return lowTreadTires;
    } catch (error) {
      console.error('Error getting low stock tires:', error);
      return [];
    }
  }

  // Alerts and Monitoring
  async getTireAlerts(): Promise<Array<{
    type: 'low_tread' | 'high_pressure' | 'low_pressure' | 'maintenance_due';
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    tireId: number;
    vehicleId?: number;
    data: any;
  }>> {
    try {
      const alerts = [];
      
      // Alertes pour profondeur de sculpture faible
      const lowTreadTires = await db
        .select({
          id: tires.id,
          brand: tires.brand,
          model: tires.model,
          treadDepth: tires.treadDepth,
          vehicleId: vehicleTires.vehicleId,
          position: vehicleTires.position
        })
        .from(tires)
        .leftJoin(vehicleTires, and(
          eq(tires.id, vehicleTires.tireId),
          isNull(vehicleTires.removedAt)
        ))
        .where(lte(tires.treadDepth, 3));
      
      lowTreadTires.forEach(tire => {
        const severity = tire.treadDepth <= 1.6 ? 'critical' : tire.treadDepth <= 2 ? 'high' : 'medium';
        alerts.push({
          type: 'low_tread' as const,
          message: `Pneu ${tire.brand} ${tire.model} - Profondeur faible: ${tire.treadDepth}mm`,
          severity,
          tireId: tire.id,
          vehicleId: tire.vehicleId,
          data: { treadDepth: tire.treadDepth, position: tire.position }
        });
      });
      
      // Alertes pour pression anormale
      const pressureTires = await db
        .select({
          id: tires.id,
          brand: tires.brand,
          model: tires.model,
          pressure: tires.pressure,
          vehicleId: vehicleTires.vehicleId,
          position: vehicleTires.position
        })
        .from(tires)
        .leftJoin(vehicleTires, and(
          eq(tires.id, vehicleTires.tireId),
          isNull(vehicleTires.removedAt)
        ))
        .where(or(
          lte(tires.pressure, 25), // Pression basse
          gte(tires.pressure, 45)  // Pression haute
        ));
      
      pressureTires.forEach(tire => {
        const isLow = tire.pressure <= 25;
        alerts.push({
          type: isLow ? 'low_pressure' : 'high_pressure',
          message: `Pneu ${tire.brand} ${tire.model} - Pression ${isLow ? 'basse' : 'haute'}: ${tire.pressure} PSI`,
          severity: tire.pressure <= 20 || tire.pressure >= 50 ? 'high' : 'medium',
          tireId: tire.id,
          vehicleId: tire.vehicleId,
          data: { pressure: tire.pressure, position: tire.position }
        });
      });
      
      return alerts;
    } catch (error) {
      console.error('Error getting tire alerts:', error);
      return [];
    }
  }
}

export const tiresService = new TiresService();
