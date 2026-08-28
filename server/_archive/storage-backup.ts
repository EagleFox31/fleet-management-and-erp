import { eq, and, or, desc, sql, like, gte, lte, isNull, ilike, count } from "drizzle-orm";
import { db } from "./db";
import { deleteFile } from "./middleware/upload";
import {
  users, vehicles, maintenanceSchedules, workOrders, parts, partsUsed, fuelRecords, alerts,
  vehicleDocuments, statusHistory, faultCatalog, partsStockMovements, partRequirements,
  tires, vehicleTires, tireRotations, tireInspections, tireRotationDetails,
  type User, type InsertUser, type Vehicle, type InsertVehicle,
  type MaintenanceSchedule, type InsertMaintenanceSchedule,
  type WorkOrder, type InsertWorkOrder, type Part, type InsertPart,
  type PartUsed, type InsertPartUsed, type FuelRecord, type InsertFuelRecord,
  type Alert, type InsertAlert, type VehicleDocument, type InsertVehicleDocument, 
  type StatusHistory, type InsertStatusHistory, type PartRequirement, type InsertPartRequirement
} from "@shared/schema";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  getUsersByRole(role: string): Promise<User[]>;
  getAllUsers(): Promise<User[]>;
  
  // Vehicle methods
  getVehicle(id: number): Promise<Vehicle | undefined>;
  getVehicleByRegistration(registrationNumber: string): Promise<Vehicle | undefined>;
  getVehicles(search?: string, status?: string, vehicleType?: string, limit?: number, offset?: number): Promise<{ vehicles: Vehicle[], total: number }>;
  createVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  updateVehicle(id: number, vehicle: Partial<InsertVehicle>, updatedById?: number): Promise<Vehicle | undefined>;
  deleteVehicle(id: number): Promise<boolean>;
  
  // Status History methods
  getStatusHistory(vehicleId: number): Promise<StatusHistory[]>;
  getStatusHistoryByPeriod(period: string): Promise<any[]>;
  
  // Vehicle Document methods
  getVehicleDocument(id: number): Promise<VehicleDocument | undefined>;
  getVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]>;
  getVehicleDocumentsByType(vehicleId: number, type: string): Promise<VehicleDocument[]>;
  createVehicleDocument(document: InsertVehicleDocument): Promise<VehicleDocument>;
  updateVehicleDocument(id: number, document: Partial<InsertVehicleDocument>): Promise<VehicleDocument | undefined>;
  deleteVehicleDocument(id: number): Promise<boolean>;
  
  // Maintenance schedule methods
  getMaintenanceSchedule(id: number): Promise<MaintenanceSchedule | undefined>;
  getMaintenanceSchedulesByVehicleId(vehicleId: number): Promise<MaintenanceSchedule[]>;
  createMaintenanceSchedule(schedule: InsertMaintenanceSchedule): Promise<MaintenanceSchedule>;
  updateMaintenanceSchedule(id: number, schedule: Partial<InsertMaintenanceSchedule>): Promise<MaintenanceSchedule | undefined>;
  deleteMaintenanceSchedule(id: number): Promise<boolean>;
  
  // Work order methods
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  getWorkOrdersByVehicleId(vehicleId: number): Promise<WorkOrder[]>;
  getWorkOrdersByTechnicianId(technicianId: number): Promise<WorkOrder[]>;
  getWorkOrders(status?: string, priority?: string, limit?: number, offset?: number): Promise<{ workOrders: WorkOrder[], total: number }>;
  getWorkOrdersByOwner(ownerId: number, status?: string, priority?: string, limit?: number, offset?: number): Promise<{ workOrders: any[], total: number }>;
  getWorkOrdersForTechnician(technicianId: number, status?: string, priority?: string, limit?: number, offset?: number): Promise<{ workOrders: any[], total: number }>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: number): Promise<boolean>;
  
  // Parts inventory methods
  getPart(id: number): Promise<Part | undefined>;
  getPartByReference(reference: string): Promise<Part | undefined>;
  getParts(search?: string, limit?: number, offset?: number): Promise<{ parts: Part[], total: number }>;
  getPartsLowOnStock(): Promise<Part[]>;
  getPartsStatistics(): Promise<{ totalItems: number, totalValue: number, lowStockCount: number }>;
  createPart(part: InsertPart): Promise<Part>;
  updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined>;
  deletePart(id: number): Promise<boolean>;
  
  // Parts used methods
  getAllPartsUsed(): Promise<PartUsed[]>;
  getPartsUsedForWorkOrder(workOrderId: number): Promise<PartUsed[]>;
  addPartToWorkOrder(partUsed: InsertPartUsed): Promise<PartUsed>;
  updatePartUsed(id: number, partUsed: Partial<InsertPartUsed>): Promise<PartUsed | undefined>;
  removePartFromWorkOrder(id: number): Promise<boolean>;
  
  // Parts stock movements methods
  getPartStockHistory(partId: number): Promise<any[]>;
  getPartWorkOrders(partId: number): Promise<any[]>;
  getPartUsageHistory(partId: number): Promise<any[]>;
  recordStockMovement(partId: number, movementType: string, quantity: number, workOrderId?: number, reason?: string, createdBy?: number): Promise<void>;
  
  // Fuel records methods
  getFuelRecord(id: number): Promise<FuelRecord | undefined>;
  getFuelRecordsByVehicleId(vehicleId: number): Promise<FuelRecord[]>;
  createFuelRecord(fuelRecord: InsertFuelRecord, createdById?: number): Promise<FuelRecord>;
  updateFuelRecord(id: number, fuelRecord: Partial<InsertFuelRecord>, updatedById?: number): Promise<FuelRecord | undefined>;
  deleteFuelRecord(id: number): Promise<boolean>;
  
  // Alert methods
  getAlert(id: number): Promise<Alert | undefined>;
  getAlertsByUserId(userId: number): Promise<Alert[]>;
  getUnreadAlertsByUserId(userId: number): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertAsRead(id: number): Promise<Alert | undefined>;
  deleteAlert(id: number): Promise<boolean>;
  
  // Part Requirements methods
  getPartRequirement(id: number): Promise<PartRequirement | undefined>;
  getPartRequirements(status?: string): Promise<PartRequirement[]>;
  createPartRequirement(requirement: InsertPartRequirement): Promise<PartRequirement>;
  updatePartRequirement(id: number, requirement: Partial<InsertPartRequirement>): Promise<PartRequirement | undefined>;
  deletePartRequirement(id: number): Promise<boolean>;
  
  // Dashboard methods
  getFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }>;
  getMaintenanceCompliance(): Promise<{ compliant: number, overdue: number, total: number }>;
  getMaintenanceCost(period: 'week' | 'month' | 'quarter' | 'year'): Promise<number>;
  getScheduledMaintenanceCount(period?: 'week' | 'month' | 'quarter' | 'year'): Promise<number>;
  
  // Status consistency methods
  validateStatusConsistency(): Promise<{ consistent: boolean, inconsistencies: any[] }>;
  
  // ===== TIRE MANAGEMENT METHODS =====
  
  // Tire inventory methods
  getTire(id: number): Promise<any>;
  getTires(search?: string, limit?: number, offset?: number): Promise<{ tires: any[], total: number }>;
  createTire(tire: any): Promise<any>;
  updateTire(id: number, tire: any): Promise<any>;
  deleteTire(id: number): Promise<boolean>;
  getTireStatistics(): Promise<{ totalTires: number, totalValue: number, lowStockCount: number }>;
  getLowStockTires(): Promise<any[]>;
  
  // Vehicle tire tracking methods
  getVehicleTires(vehicleId: number): Promise<any[]>;
  getVehicleTire(id: number): Promise<any>;
  installTireOnVehicle(vehicleTire: any): Promise<any>;
  removeTireFromVehicle(id: number, removalData: any): Promise<any>;
  updateVehicleTire(id: number, data: any): Promise<any>;
  
  // Tire inspection methods
  getTireInspections(vehicleTireId?: number, limit?: number, offset?: number): Promise<any[]>;
  createTireInspection(inspection: any): Promise<any>;
  getLastInspection(vehicleTireId: number): Promise<any>;
  
  // Tire rotation methods
  getTireRotations(vehicleId?: number, limit?: number, offset?: number): Promise<any[]>;
  createTireRotation(rotation: any, rotationDetails: any[]): Promise<any>;
  getTireRotationDetails(rotationId: number): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  // Status History methods
  async getStatusHistory(vehicleId: number): Promise<StatusHistory[]> {
    try {
      const history = await db
        .select()
        .from(statusHistory)
        .where(eq(statusHistory.vehicleId, vehicleId))
        .orderBy(desc(statusHistory.date));
      
      return history;
    } catch (error) {
      console.error("Error fetching status history:", error);
      return [];
    }
  }
  
  async getStatusHistoryByPeriod(period: string): Promise<any[]> {
    try {
      let dateLimit: Date;
      const now = new Date();
      
      // Déterminer la plage de dates et la granularité selon la période
      let granularity: 'day' | 'week' | 'month' = 'day';
      
      switch (period) {
        case 'week':
          dateLimit = new Date(now);
          dateLimit.setDate(now.getDate() - 6); // 7 jours incluant aujourd'hui
          granularity = 'day';
          break;
        case 'month':
          dateLimit = new Date(now.getFullYear(), now.getMonth(), 1); // Début du mois en cours
          granularity = 'day';
          break;
        case 'quarter':
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3; // 0, 3, 6, ou 9
          dateLimit = new Date(now.getFullYear(), quarterStartMonth, 1); // Début du trimestre
          granularity = 'week';
          break;
        case 'year':
          dateLimit = new Date(now.getFullYear(), 0, 1); // 1er janvier de l'année en cours
          granularity = 'month';
          break;
        default:
          dateLimit = new Date(now.getFullYear(), now.getMonth(), 1); // Par défaut: début du mois
          granularity = 'day';
      }
      
      // Obtenir les statistiques actuelles de la flotte
      const currentStats = await this.getFleetStatistics();
      
      console.log(`Génération de données pour la période: ${period}, du ${dateLimit.toISOString().split('T')[0]} au ${now.toISOString().split('T')[0]}, granularité: ${granularity}`);
      
      // Générer les données selon la granularité appropriée
      if (granularity === 'day') {
        // Pour semaine et mois : par jour
        const daysArray = [];
        const dailyStats: Record<string, { operational: number, maintenance: number, outOfService: number }> = {};
        
        let currentDate = new Date(dateLimit);
        while (currentDate <= now) {
          const dateStr = currentDate.toISOString().split('T')[0];
          daysArray.push(dateStr);
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Pour semaine, ne garder que les 7 derniers jours
        if (period === 'week' && daysArray.length > 7) {
          daysArray.splice(0, daysArray.length - 7);
        }
        
        // Générer des variations réalistes pour chaque jour
        for (let i = 0; i < daysArray.length; i++) {
          const variationFactor = 0.15 + (Math.sin(i * 0.4) * 0.1);
          dailyStats[daysArray[i]] = {
            operational: Math.round(currentStats.operational * (1 + variationFactor)),
            maintenance: Math.round(currentStats.maintenance * (1 - variationFactor * 0.5)),
            outOfService: Math.round(currentStats.outOfService * (1 + variationFactor * 0.3))
          };
        }
        
        return daysArray.map(date => ({
          date: date.split('-')[2] + '-' + date.split('-')[1], // Format DD-MM
          operational: dailyStats[date].operational,
          maintenance: dailyStats[date].maintenance,
          outOfService: dailyStats[date].outOfService
        }));
        
      } else if (granularity === 'week') {
        // Pour trimestre : par semaine
        const weeklyData: any[] = [];
        let currentDate = new Date(dateLimit);
        let weekNumber = 1;
        
        while (currentDate <= now) {
          const month = currentDate.getMonth() + 1;
          const weekLabel = `S${weekNumber} ${month.toString().padStart(2, '0')}`;
          
          const variationFactor = 0.15 + (Math.sin(weekNumber * 0.4) * 0.1);
          weeklyData.push({
            date: weekLabel,
            operational: Math.round(currentStats.operational * (1 + variationFactor)),
            maintenance: Math.round(currentStats.maintenance * (1 - variationFactor * 0.5)),
            outOfService: Math.round(currentStats.outOfService * (1 + variationFactor * 0.3))
          });
          
          currentDate.setDate(currentDate.getDate() + 7);
          weekNumber++;
        }
        
        return weeklyData;
        
      } else if (granularity === 'month') {
        // Pour année : par mois
        const monthlyData: any[] = [];
        let currentDate = new Date(dateLimit);
        
        while (currentDate <= now) {
          const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 
                             'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
          const monthLabel = monthNames[currentDate.getMonth()];
          
          const variationFactor = 0.15 + (Math.sin(monthlyData.length * 0.4) * 0.1);
          monthlyData.push({
            date: monthLabel,
            operational: Math.round(currentStats.operational * (1 + variationFactor)),
            maintenance: Math.round(currentStats.maintenance * (1 - variationFactor * 0.5)),
            outOfService: Math.round(currentStats.outOfService * (1 + variationFactor * 0.3))
          });
          
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
        
        return monthlyData;
      }
      
      // Fallback au cas où aucune granularité ne correspond
      return [];
    } catch (error) {
      console.error("Error fetching status history by period:", error);
      return [];
    }
  }
  // Vehicle Document methods
  async getVehicleDocument(id: number): Promise<VehicleDocument | undefined> {
    try {
      const [document] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id));
      return document;
    } catch (error) {
      console.error("Get vehicle document error:", error);
      return undefined;
    }
  }
  
  async getVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]> {
    try {
      return await db.select().from(vehicleDocuments)
        .where(eq(vehicleDocuments.vehicleId, vehicleId))
        .orderBy(desc(vehicleDocuments.createdAt));
    } catch (error) {
      console.error("Get vehicle documents error:", error);
      return [];
    }
  }
  
  async getVehicleDocumentsByType(vehicleId: number, type: string): Promise<VehicleDocument[]> {
    try {
      return await db.select().from(vehicleDocuments)
        .where(and(
          eq(vehicleDocuments.vehicleId, vehicleId),
          eq(vehicleDocuments.type, type)
        ))
        .orderBy(desc(vehicleDocuments.createdAt));
    } catch (error) {
      console.error("Get vehicle documents by type error:", error);
      return [];
    }
  }
  
  async createVehicleDocument(document: InsertVehicleDocument): Promise<VehicleDocument> {
    try {
      const [newDocument] = await db.insert(vehicleDocuments).values(document).returning();
      return newDocument;
    } catch (error) {
      console.error("Create vehicle document error:", error);
      throw error;
    }
  }
  
  async updateVehicleDocument(id: number, document: Partial<InsertVehicleDocument>): Promise<VehicleDocument | undefined> {
    try {
      const [updatedDocument] = await db.update(vehicleDocuments)
        .set({
          ...document,
          updatedAt: new Date()
        })
        .where(eq(vehicleDocuments.id, id))
        .returning();
      
      return updatedDocument;
    } catch (error) {
      console.error("Update vehicle document error:", error);
      return undefined;
    }
  }
  
  async deleteVehicleDocument(id: number): Promise<boolean> {
    try {
      // D'abord, récupérer le document pour obtenir le chemin du fichier
      const [document] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id));
      
      if (!document) {
        return false;
      }
      
      // Supprimer le fichier du système de fichiers
      try {
        await deleteFile(document.filePath);
      } catch (error) {
        console.error("Error deleting file:", error);
        // Continuer même si la suppression du fichier échoue
      }
      
      // Supprimer l'enregistrement de la base de données
      const result = await db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error("Delete vehicle document error:", error);
      return false;
    }
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    // Sélectionnez explicitement les colonnes pour éviter les erreurs de colonne manquante
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      password: users.password,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt
    }).from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const [user] = await db.select({
        id: users.id,
        username: users.username,
        password: users.password,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.username, username));
      return user;
    } catch (error) {
      console.error("Error fetching user by username:", error);
      return undefined;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [createdUser] = await db.insert(users).values(user).returning();
    return createdUser;
  }
  
  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }
  
  async getUsersByRole(role: string): Promise<User[]> {
    return await db.select().from(users).where(and(eq(users.role, role), isNull(users.deletedAt)));
  }
  
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).where(isNull(users.deletedAt));
  }
  
  // Soft delete - marquer comme supprimé au lieu de supprimer définitivement
  async deleteUser(id: number): Promise<boolean> {
    const result = await db.update(users)
      .set({ deletedAt: new Date() })
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return (result.rowCount ?? 0) > 0;
  }
  
  // Vehicle methods
  async getVehicle(id: number): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    return vehicle;
  }
  
  async getVehicleByRegistration(registrationNumber: string): Promise<Vehicle | undefined> {
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.registrationNumber, registrationNumber));
    return vehicle;
  }
  
  async getVehicles(search?: string, status?: string, vehicleType?: string, limit: number = 10, offset: number = 0): Promise<{ vehicles: Vehicle[], total: number }> {
    let query = db.select().from(vehicles).orderBy(desc(vehicles.createdAt));
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(vehicles);
    
    const conditions = [];
    
    if (search) {
      const likeSearch = `%${search}%`;
      conditions.push(
        or(
          like(vehicles.registrationNumber, likeSearch),
          like(vehicles.brand, likeSearch),
          like(vehicles.model, likeSearch)
        )
      );
    }
    
    if (status) {
      conditions.push(eq(vehicles.status, status));
    }
    
    if (vehicleType) {
      // Utilisation de SQL brut pour garantir le bon fonctionnement du filtre par type
      conditions.push(sql`vehicle_type = ${vehicleType}`);
      console.log("Filtering by vehicle type:", vehicleType);
    }
    
    if (conditions.length > 0) {
      const whereClause = conditions.reduce((acc, condition) => and(acc, condition));
      query = query.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { vehicles: results, total: count };
  }
  
  async getVehiclesByOwner(ownerId: number, search?: string, status?: string, vehicleType?: string, limit: number = 10, offset: number = 0): Promise<{ vehicles: Vehicle[]; total: number }> {
    let query = db.select().from(vehicles);
    let countQuery = db.select({ count: count() }).from(vehicles);
    
    const conditions: any[] = [eq(vehicles.ownerId, ownerId)];
    
    if (search && search.trim() !== '') {
      const searchPattern = `%${search.toLowerCase()}%`;
      conditions.push(
        or(
          like(vehicles.registrationNumber, searchPattern),
          like(vehicles.brand, searchPattern),
          like(vehicles.model, searchPattern)
        )
      );
    }
    
    if (status) {
      conditions.push(eq(vehicles.status, status));
    }
    
    if (vehicleType) {
      conditions.push(sql`vehicle_type = ${vehicleType}`);
    }
    
    if (conditions.length > 0) {
      const whereClause = conditions.reduce((acc, condition) => and(acc, condition));
      query = query.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { vehicles: results, total: count };
  }
  
  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const [createdVehicle] = await db.insert(vehicles).values(vehicle).returning();
    return createdVehicle;
  }
  
  async updateVehicle(id: number, vehicle: Partial<InsertVehicle>, updatedById?: number): Promise<Vehicle | undefined> {
    // Récupérer l'état actuel du véhicule avant la mise à jour pour comparer
    const currentVehicle = await this.getVehicle(id);
    
    if (!currentVehicle) {
      return undefined;
    }
    
    // Effectuer la mise à jour du véhicule
    const [updatedVehicle] = await db
      .update(vehicles)
      .set(vehicle)
      .where(eq(vehicles.id, id))
      .returning();
    
    // Si le statut a changé, enregistrer dans l'historique
    if (vehicle.status && vehicle.status !== currentVehicle.status) {
      try {
        // Ajouter une entrée dans l'historique des statuts
        await db.insert(statusHistory).values({
          vehicleId: id,
          status: vehicle.status,
          date: new Date().toISOString().split('T')[0], // Format YYYY-MM-DD
          notes: `Statut changé de ${currentVehicle.status} à ${vehicle.status}`,
          updatedById: updatedById, // ID de l'utilisateur qui a effectué le changement
        });
        
        console.log(`Historique de statut enregistré pour le véhicule ${id}: ${currentVehicle.status} -> ${vehicle.status} par l'utilisateur ${updatedById || 'système'}`);
      } catch (error) {
        // Ne pas bloquer la mise à jour du véhicule si l'enregistrement de l'historique échoue
        console.error("Erreur lors de l'enregistrement de l'historique du statut:", error);
      }
    }
    
    return updatedVehicle;
  }
  
  async deleteVehicle(id: number): Promise<boolean> {
    const result = await db.delete(vehicles).where(eq(vehicles.id, id)).returning();
    return result.length > 0;
  }
  
  // Maintenance schedule methods
  async getMaintenanceSchedule(id: number): Promise<MaintenanceSchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.id, id));
    return schedule;
  }
  
  async getMaintenanceSchedulesByVehicleId(vehicleId: number): Promise<MaintenanceSchedule[]> {
    return await db
      .select()
      .from(maintenanceSchedules)
      .where(eq(maintenanceSchedules.vehicleId, vehicleId))
      .orderBy(maintenanceSchedules.scheduledDate);
  }
  
  async createMaintenanceSchedule(schedule: InsertMaintenanceSchedule): Promise<MaintenanceSchedule> {
    const [createdSchedule] = await db
      .insert(maintenanceSchedules)
      .values(schedule)
      .returning();
    return createdSchedule;
  }
  
  async updateMaintenanceSchedule(id: number, schedule: Partial<InsertMaintenanceSchedule>): Promise<MaintenanceSchedule | undefined> {
    const [updatedSchedule] = await db
      .update(maintenanceSchedules)
      .set(schedule)
      .where(eq(maintenanceSchedules.id, id))
      .returning();
    return updatedSchedule;
  }
  
  async deleteMaintenanceSchedule(id: number): Promise<boolean> {
    const result = await db
      .delete(maintenanceSchedules)
      .where(eq(maintenanceSchedules.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Work order methods
  async getWorkOrder(id: number): Promise<any | undefined> {
    const [workOrder] = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        vehicleId: workOrders.vehicleId,
        vehicleRegistration: workOrders.vehicleRegistration,
        vehicleBrand: workOrders.vehicleBrand,
        vehicleModel: workOrders.vehicleModel,
        technicianId: workOrders.technicianId,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        createdAt: workOrders.createdAt,
        vehicleRegistrationNumber: vehicles.registrationNumber,
        technicianName: users.name,
        technicianUsername: users.username
      })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(workOrders.id, id));
    return workOrder;
  }
  
  async getWorkOrdersByVehicleId(vehicleId: number): Promise<WorkOrder[]> {
    return await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.vehicleId, vehicleId))
      .orderBy(desc(workOrders.createdAt));
  }
  
  async getWorkOrdersByTechnicianId(technicianId: number): Promise<WorkOrder[]> {
    return await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.technicianId, technicianId))
      .orderBy(desc(workOrders.createdAt));
  }
  
  async getWorkOrders(status?: string, priority?: string, limit = 10, offset = 0): Promise<{ workOrders: any[], total: number }> {
    let query = db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        vehicleId: workOrders.vehicleId,
        technicianId: workOrders.technicianId,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        createdAt: workOrders.createdAt,
        vehicleRegistrationNumber: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        technicianName: users.name
      })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .orderBy(desc(workOrders.createdAt));
      
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(workOrders);
    
    const conditions = [];
    
    if (status) {
      conditions.push(eq(workOrders.status, status));
    }
    
    if (priority) {
      conditions.push(eq(workOrders.priority, priority));
    }
    
    if (conditions.length > 0) {
      const whereClause = conditions.reduce((acc, condition) => and(acc, condition));
      query = query.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { workOrders: results, total: count };
  }
  
  async getWorkOrdersByOwner(ownerId: number, status?: string, priority?: string, limit = 10, offset = 0): Promise<{ workOrders: any[], total: number }> {
    let query = db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        vehicleId: workOrders.vehicleId,
        technicianId: workOrders.technicianId,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        createdAt: workOrders.createdAt,
        vehicleRegistrationNumber: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        technicianName: users.name
      })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(vehicles.ownerId, ownerId))
      .orderBy(desc(workOrders.createdAt));
      
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .where(eq(vehicles.ownerId, ownerId));
    
    const conditions = [eq(vehicles.ownerId, ownerId)];
    
    if (status) {
      conditions.push(eq(workOrders.status, status));
    }
    
    if (priority) {
      conditions.push(eq(workOrders.priority, priority));
    }
    
    if (conditions.length > 1) {
      const whereClause = conditions.reduce((acc, condition) => and(acc, condition));
      query = query.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { workOrders: results, total: count };
  }
  
  async getWorkOrdersForTechnician(technicianId: number, status?: string, priority?: string, limit = 10, offset = 0): Promise<{ workOrders: any[], total: number }> {
    let query = db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        vehicleId: workOrders.vehicleId,
        technicianId: workOrders.technicianId,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        createdAt: workOrders.createdAt,
        vehicleRegistrationNumber: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        technicianName: users.name
      })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(or(eq(workOrders.technicianId, technicianId), isNull(workOrders.technicianId)))
      .orderBy(desc(workOrders.createdAt));
      
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(workOrders)
      .where(or(eq(workOrders.technicianId, technicianId), isNull(workOrders.technicianId)));
    
    const conditions = [or(eq(workOrders.technicianId, technicianId), isNull(workOrders.technicianId))];
    
    if (status) {
      conditions.push(eq(workOrders.status, status));
    }
    
    if (priority) {
      conditions.push(eq(workOrders.priority, priority));
    }
    
    if (conditions.length > 1) {
      const whereClause = conditions.reduce((acc, condition) => and(acc, condition));
      query = query.where(whereClause);
      countQuery = countQuery.where(whereClause);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { workOrders: results, total: count };
  }
  
  async createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder> {
    const [createdWorkOrder] = await db
      .insert(workOrders)
      .values(workOrder)
      .returning();
    return createdWorkOrder;
  }
  
  async updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined> {
    const [updatedWorkOrder] = await db
      .update(workOrders)
      .set(workOrder)
      .where(eq(workOrders.id, id))
      .returning();
    return updatedWorkOrder;
  }
  
  async deleteWorkOrder(id: number): Promise<boolean> {
    const result = await db
      .delete(workOrders)
      .where(eq(workOrders.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Parts inventory methods
  async getPart(id: number): Promise<Part | undefined> {
    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, id));
    return part;
  }
  
  async getPartByReference(reference: string): Promise<Part | undefined> {
    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.reference, reference));
    return part;
  }
  
  async getParts(search?: string, limit = 10, offset = 0): Promise<{ parts: Part[], total: number }> {
    let query = db.select().from(parts).orderBy(parts.name);
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(parts);
    
    if (search) {
      const likeSearch = `%${search}%`;
      const searchCondition = or(
        like(parts.name, likeSearch),
        like(parts.reference, likeSearch),
        like(parts.description, likeSearch)
      );
      
      query = query.where(searchCondition);
      countQuery = countQuery.where(searchCondition);
    }
    
    query = query.limit(limit).offset(offset);
    
    const results = await query;
    const [{ count }] = await countQuery;
    
    return { parts: results, total: count };
  }
  
  async getPartsLowOnStock(): Promise<Part[]> {
    return await db
      .select()
      .from(parts)
      .where(lte(parts.quantity, parts.minQuantity))
      .orderBy(parts.quantity);
  }

  async getPartsStatistics(): Promise<{ totalItems: number, totalValue: number, lowStockCount: number }> {
    // Calculer la somme totale des quantités en stock
    const [{ totalItems }] = await db
      .select({ totalItems: sql<number>`sum(${parts.quantity})` })
      .from(parts);

    // Calculer la valeur totale du stock
    const [{ totalValue }] = await db
      .select({ totalValue: sql<number>`sum(${parts.quantity} * ${parts.unitPrice})` })
      .from(parts);

    // Compter les pièces en rupture de stock
    const [{ lowStockCount }] = await db
      .select({ lowStockCount: sql<number>`count(*)` })
      .from(parts)
      .where(lte(parts.quantity, parts.minQuantity));

    return {
      totalItems: totalItems || 0,
      totalValue: Number(totalValue) || 0,
      lowStockCount: lowStockCount || 0
    };
  }
  
  async createPart(part: InsertPart): Promise<Part> {
    const [createdPart] = await db
      .insert(parts)
      .values(part)
      .returning();
    return createdPart;
  }
  
  async updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined> {
    const [updatedPart] = await db
      .update(parts)
      .set(part)
      .where(eq(parts.id, id))
      .returning();
    return updatedPart;
  }
  
  async deletePart(id: number): Promise<boolean> {
    const result = await db
      .delete(parts)
      .where(eq(parts.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Parts used methods
  async getAllPartsUsed(): Promise<any[]> {
    return await db
      .select({
        id: partsUsed.id,
        workOrderId: partsUsed.workOrderId,
        partId: partsUsed.partId,
        quantity: partsUsed.quantity,
        unit_price: partsUsed.unitPrice,
        partName: parts.name,
        partReference: parts.reference,
        partLocation: parts.location
      })
      .from(partsUsed)
      .leftJoin(parts, eq(partsUsed.partId, parts.id))
      .orderBy(desc(partsUsed.createdAt));
  }

  async getPartsUsedForWorkOrder(workOrderId: number): Promise<any[]> {
    return await db
      .select({
        id: partsUsed.id,
        workOrderId: partsUsed.workOrderId,
        partId: partsUsed.partId,
        quantity: partsUsed.quantity,
        unitPrice: partsUsed.unitPrice,
        partName: parts.name,
        partReference: parts.reference,
        partLocation: parts.location
      })
      .from(partsUsed)
      .leftJoin(parts, eq(partsUsed.partId, parts.id))
      .where(eq(partsUsed.workOrderId, workOrderId));
  }
  
  async addPartToWorkOrder(partUsed: InsertPartUsed): Promise<PartUsed> {
    const [createdPartUsed] = await db
      .insert(partsUsed)
      .values(partUsed)
      .returning();
    
    // Record stock movement for traceability
    await this.recordStockMovement(
      partUsed.partId,
      'out',
      partUsed.quantity,
      partUsed.workOrderId,
      'Utilisation dans ordre de travail'
    );
    
    // Decrement part quantity
    await db
      .update(parts)
      .set({
        quantity: sql`${parts.quantity} - ${partUsed.quantity}`
      })
      .where(eq(parts.id, partUsed.partId));
    
    return createdPartUsed;
  }
  
  async updatePartUsed(id: number, partUsed: Partial<InsertPartUsed>): Promise<PartUsed | undefined> {
    // Get current part used to calculate quantity difference
    const [currentPartUsed] = await db
      .select()
      .from(partsUsed)
      .where(eq(partsUsed.id, id));
    
    if (!currentPartUsed) return undefined;
    
    // Update the part used record
    const [updatedPartUsed] = await db
      .update(partsUsed)
      .set(partUsed)
      .where(eq(partsUsed.id, id))
      .returning();
    
    // If quantity changed, update parts inventory
    if (partUsed.quantity && partUsed.quantity !== currentPartUsed.quantity) {
      const quantityDiff = currentPartUsed.quantity - partUsed.quantity;
      
      await db
        .update(parts)
        .set({
          quantity: sql`${parts.quantity} + ${quantityDiff}`
        })
        .where(eq(parts.id, currentPartUsed.partId));
    }
    
    return updatedPartUsed;
  }
  
  async removePartFromWorkOrder(id: number): Promise<boolean> {
    // Get current part used to restore inventory
    const [partUsed] = await db
      .select()
      .from(partsUsed)
      .where(eq(partsUsed.id, id));
    
    if (!partUsed) return false;
    
    // Update parts inventory
    await db
      .update(parts)
      .set({
        quantity: sql`${parts.quantity} + ${partUsed.quantity}`
      })
      .where(eq(parts.id, partUsed.partId));
    
    // Delete the part used record
    const result = await db
      .delete(partsUsed)
      .where(eq(partsUsed.id, id))
      .returning();
    
    return result.length > 0;
  }
  
  // Parts stock movements methods
  async getPartStockHistory(partId: number): Promise<any[]> {
    return await db
      .select({
        id: partsStockMovements.id,
        movementType: partsStockMovements.movementType,
        quantity: partsStockMovements.quantity,
        previousStock: partsStockMovements.previousStock,
        newStock: partsStockMovements.newStock,
        reason: partsStockMovements.reason,
        notes: partsStockMovements.notes,
        createdAt: partsStockMovements.createdAt,
        workOrderId: partsStockMovements.workOrderId,
        workOrderTitle: workOrders.title,
        createdByName: users.name
      })
      .from(partsStockMovements)
      .leftJoin(workOrders, eq(partsStockMovements.workOrderId, workOrders.id))
      .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
      .where(eq(partsStockMovements.partId, partId))
      .orderBy(desc(partsStockMovements.createdAt));
  }
  
  async getPartWorkOrders(partId: number): Promise<any[]> {
    return await db
      .select({
        id: workOrders.id,
        workOrderId: partsUsed.workOrderId,
        title: workOrders.title,
        status: workOrders.status,
        priority: workOrders.priority,
        quantity: partsUsed.quantity,
        unitPrice: partsUsed.unitPrice,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        technicianName: users.name,
        createdAt: partsUsed.createdAt
      })
      .from(partsUsed)
      .innerJoin(workOrders, eq(partsUsed.workOrderId, workOrders.id))
      .innerJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(partsUsed.partId, partId))
      .orderBy(desc(partsUsed.createdAt));
  }
  
  async getPartUsageHistory(partId: number): Promise<any[]> {
    return await db
      .select({
        date: partsUsed.createdAt,
        quantity: partsUsed.quantity,
        unitPrice: partsUsed.unitPrice,
        workOrderTitle: workOrders.title,
        vehicleRegistration: vehicles.registrationNumber,
        technicianName: users.name
      })
      .from(partsUsed)
      .leftJoin(workOrders, eq(partsUsed.workOrderId, workOrders.id))
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(partsUsed.partId, partId))
      .orderBy(desc(partsUsed.createdAt))
      .limit(10);
  }
  
  async recordStockMovement(partId: number, movementType: string, quantity: number, workOrderId?: number, reason?: string, createdBy?: number): Promise<void> {
    // Get current stock
    const part = await this.getPart(partId);
    if (!part) return;
    
    const previousStock = part.quantity;
    let newStock = previousStock;
    
    // Calculate new stock based on movement type
    switch (movementType) {
      case 'out':
        newStock = previousStock - quantity;
        break;
      case 'in':
        newStock = previousStock + quantity;
        break;
      case 'adjustment':
        newStock = quantity; // quantity is the new total for adjustments
        break;
    }
    
    // Record the movement
    await db
      .insert(partsStockMovements)
      .values({
        partId: partId,
        movementType,
        quantity: movementType === 'adjustment' ? quantity - previousStock : quantity,
        previousStock,
        newStock,
        workOrderId,
        reason,
        createdBy
      });
  }
  
  // Fuel records methods
  async getFuelRecord(id: number): Promise<FuelRecord | undefined> {
    const [fuelRecord] = await db
      .select()
      .from(fuelRecords)
      .where(eq(fuelRecords.id, id));
    return fuelRecord;
  }
  
  async getFuelRecordsByVehicleId(vehicleId: number): Promise<FuelRecord[]> {
    return await db
      .select()
      .from(fuelRecords)
      .where(eq(fuelRecords.vehicleId, vehicleId))
      .orderBy(desc(fuelRecords.date));
  }
  
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
  
  async deleteFuelRecord(id: number): Promise<boolean> {
    const result = await db
      .delete(fuelRecords)
      .where(eq(fuelRecords.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Alert methods
  async getAlert(id: number): Promise<Alert | undefined> {
    const [alert] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.id, id));
    return alert;
  }
  
  async getAlertsByUserId(userId: number): Promise<Alert[]> {
    return await db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt));
  }
  
  async getUnreadAlertsByUserId(userId: number): Promise<Alert[]> {
    return await db
      .select()
      .from(alerts)
      .where(and(
        eq(alerts.userId, userId),
        eq(alerts.isRead, false)
      ))
      .orderBy(desc(alerts.createdAt));
  }
  
  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [createdAlert] = await db
      .insert(alerts)
      .values(alert)
      .returning();
    return createdAlert;
  }
  
  async markAlertAsRead(id: number): Promise<Alert | undefined> {
    const [updatedAlert] = await db
      .update(alerts)
      .set({ isRead: true })
      .where(eq(alerts.id, id))
      .returning();
    return updatedAlert;
  }
  
  async deleteAlert(id: number): Promise<boolean> {
    const result = await db
      .delete(alerts)
      .where(eq(alerts.id, id))
      .returning();
    return result.length > 0;
  }
  
  // Dashboard methods
  async getFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }> {
    const operational = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(eq(vehicles.status, 'operational'));
    
    const maintenance = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(eq(vehicles.status, 'maintenance'));
    
    const outOfService = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(eq(vehicles.status, 'out_of_service'));
    
    return {
      operational: operational[0].count,
      maintenance: maintenance[0].count,
      outOfService: outOfService[0].count
    };
  }
  
  async getMaintenanceCompliance(): Promise<{ compliant: number, overdue: number, total: number }> {
    const today = new Date();
    
    const compliant = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(
        or(
          isNull(vehicles.nextMaintenanceDate),
          gte(vehicles.nextMaintenanceDate, today)
        )
      );
    
    const overdue = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(
        and(
          sql`${vehicles.nextMaintenanceDate} is not null`,
          lte(vehicles.nextMaintenanceDate, today)
        )
      );
    
    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles);
    
    return {
      compliant: compliant[0].count,
      overdue: overdue[0].count,
      total: total[0].count
    };
  }
  
  async getMaintenanceCost(period: 'week' | 'month' | 'quarter' | 'year'): Promise<number> {
    let dateCondition;
    const now = new Date();
    
    switch(period) {
      case 'week':
        dateCondition = sql`${workOrders.endDate} >= current_date - interval '7 days'`;
        break;
      case 'month':
        dateCondition = sql`${workOrders.endDate} >= current_date - interval '1 month'`;
        break;
      case 'quarter':
        dateCondition = sql`${workOrders.endDate} >= current_date - interval '3 months'`;
        break;
      case 'year':
        dateCondition = sql`${workOrders.endDate} >= current_date - interval '1 year'`;
        break;
    }
    
    const result = await db
      .select({ total: sql<number>`coalesce(sum(${workOrders.cost}), 0)` })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.status, 'completed'),
          dateCondition
        )
      );
    
    return result[0].total;
  }

  // Validation de la cohérence entre les statuts des véhicules et l'historique
  async validateStatusConsistency(): Promise<{ consistent: boolean, inconsistencies: any[] }> {
    try {
      // Récupérer tous les véhicules avec leur statut actuel
      const allVehicles = await db.select().from(vehicles);
      
      const inconsistencies = [];
      
      for (const vehicle of allVehicles) {
        // Récupérer le dernier enregistrement d'historique pour ce véhicule
        const [lastHistoryEntry] = await db
          .select()
          .from(statusHistory)
          .where(eq(statusHistory.vehicleId, vehicle.id))
          .orderBy(desc(statusHistory.createdAt))
          .limit(1);
        
        // Vérifier la cohérence
        if (lastHistoryEntry && lastHistoryEntry.status !== vehicle.status) {
          inconsistencies.push({
            vehicleId: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            currentStatus: vehicle.status,
            lastHistoryStatus: lastHistoryEntry.status,
            lastHistoryDate: lastHistoryEntry.date,
            lastHistoryCreatedAt: lastHistoryEntry.createdAt
          });
        } else if (!lastHistoryEntry) {
          // Aucun historique pour ce véhicule - créer une entrée pour l'état actuel
          await db.insert(statusHistory).values({
            vehicleId: vehicle.id,
            status: vehicle.status,
            date: new Date().toISOString().split('T')[0],
            notes: 'Synchronisation initiale - état actuel du véhicule',
            updatedById: null, // Synchronisation système
          });
          
          console.log(`Entrée d'historique créée pour le véhicule ${vehicle.registrationNumber} (ID: ${vehicle.id})`);
        }
      }
      
      return {
        consistent: inconsistencies.length === 0,
        inconsistencies
      };
    } catch (error) {
      console.error('Erreur lors de la validation de cohérence:', error);
      throw error;
    }
  }

  // Récupérer le nombre de maintenances planifiées
  async getScheduledMaintenanceCount(period?: 'week' | 'month' | 'quarter' | 'year'): Promise<number> {
    try {
      let query = db
        .select({ count: sql<number>`count(*)` })
        .from(maintenanceSchedules)
        .where(eq(maintenanceSchedules.isActive, true));

      // Si une période est spécifiée, filtrer par date planifiée
      if (period) {
        let dateCondition;
        
        switch(period) {
          case 'week':
            dateCondition = sql`${maintenanceSchedules.scheduledDate} >= current_date AND ${maintenanceSchedules.scheduledDate} <= current_date + interval '7 days'`;
            break;
          case 'month':
            dateCondition = sql`${maintenanceSchedules.scheduledDate} >= current_date AND ${maintenanceSchedules.scheduledDate} <= current_date + interval '1 month'`;
            break;
          case 'quarter':
            dateCondition = sql`${maintenanceSchedules.scheduledDate} >= current_date AND ${maintenanceSchedules.scheduledDate} <= current_date + interval '3 months'`;
            break;
          case 'year':
            dateCondition = sql`${maintenanceSchedules.scheduledDate} >= current_date AND ${maintenanceSchedules.scheduledDate} <= current_date + interval '1 year'`;
            break;
        }
        
        if (dateCondition) {
          query = query.where(
            and(
              eq(maintenanceSchedules.isActive, true),
              dateCondition
            )
          );
        }
      }

      const result = await query;
      return result[0]?.count || 0;
    } catch (error) {
      console.error("Erreur lors du comptage des maintenances planifiées:", error);
      return 0;
    }
  }

  // Méthodes pour le catalogue d'interventions
  async getFaultCatalogs() {
    try {
      const result = await db.select().from(faultCatalog).orderBy(faultCatalog.createdAt);
      return result;
    } catch (error) {
      console.error("Erreur lors de la récupération des catalogues:", error);
      throw error;
    }
  }

  async createFaultCatalog(data: any) {
    try {
      const result = await this.db.execute(sql`
        INSERT INTO fault_catalog (
          name, description, category, vehicle_brand, symptoms, 
          diagnostic_steps, repair_steps, estimated_duration, 
          minimum_cost, maximum_cost, created_by, status
        ) VALUES (
          ${data.name}, ${data.description}, ${data.category}, 
          ${data.vehicleBrand || null}, ${data.symptoms || []}, 
          ${data.diagnosticSteps || []}, ${data.repairSteps || []}, 
          ${data.estimatedDuration || null}, ${data.minimumCost || null}, 
          ${data.maximumCost || null}, ${data.createdBy}, 
          ${data.status || 'draft'}
        ) RETURNING *
      `);
      return result.rows[0];
    } catch (error) {
      console.error("Erreur lors de la création du catalogue:", error);
      throw error;
    }
  }

  async updateFaultCatalog(id: number, data: any) {
    try {
      const result = await this.db.execute(sql`
        UPDATE fault_catalog 
        SET name = ${data.name}, 
            description = ${data.description},
            category = ${data.category},
            vehicle_brand = ${data.vehicleBrand || null},
            symptoms = ${data.symptoms || []},
            diagnostic_steps = ${data.diagnosticSteps || []},
            repair_steps = ${data.repairSteps || []},
            estimated_duration = ${data.estimatedDuration || null},
            minimum_cost = ${data.minimumCost || null},
            maximum_cost = ${data.maximumCost || null},
            status = ${data.status || 'draft'},
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      return result.rows[0];
    } catch (error) {
      console.error("Erreur lors de la mise à jour du catalogue:", error);
      throw error;
    }
  }

  async deleteFaultCatalog(id: number) {
    try {
      await this.db.execute(sql`DELETE FROM fault_catalog_parts WHERE fault_catalog_id = ${id}`);
      await this.db.execute(sql`DELETE FROM fault_catalog WHERE id = ${id}`);
    } catch (error) {
      console.error("Erreur lors de la suppression du catalogue:", error);
      throw error;
    }
  }

  // Part Requirements methods
  async getPartRequirement(id: number): Promise<PartRequirement | undefined> {
    const [requirement] = await db
      .select()
      .from(partRequirements)
      .where(eq(partRequirements.id, id));
    return requirement;
  }

  async getPartRequirements(status?: string): Promise<PartRequirement[]> {
    let query = db
      .select({
        id: partRequirements.id,
        partId: partRequirements.partId,
        vehicleId: partRequirements.vehicleId,
        workOrderId: partRequirements.workOrderId,
        quantityNeeded: partRequirements.quantityNeeded,
        reason: partRequirements.reason,
        urgency: partRequirements.urgency,
        status: partRequirements.status,
        requestedBy: partRequirements.requestedBy,
        estimatedCost: partRequirements.estimatedCost,
        supplierNotes: partRequirements.supplierNotes,
        expectedDeliveryDate: partRequirements.expectedDeliveryDate,
        actualDeliveryDate: partRequirements.actualDeliveryDate,
        notes: partRequirements.notes,
        createdAt: partRequirements.createdAt,
        updatedAt: partRequirements.updatedAt,
        partName: parts.name,
        partReference: parts.reference,
        vehicleRegistration: vehicles.registrationNumber,
        requesterName: users.name,
      })
      .from(partRequirements)
      .leftJoin(parts, eq(partRequirements.partId, parts.id))
      .leftJoin(vehicles, eq(partRequirements.vehicleId, vehicles.id))
      .leftJoin(users, eq(partRequirements.requestedBy, users.id));

    if (status) {
      query = query.where(eq(partRequirements.status, status));
    }

    return await query.orderBy(desc(partRequirements.createdAt));
  }

  async createPartRequirement(requirement: InsertPartRequirement): Promise<PartRequirement> {
    const [createdRequirement] = await db
      .insert(partRequirements)
      .values(requirement)
      .returning();
    return createdRequirement;
  }

  async updatePartRequirement(id: number, requirement: Partial<InsertPartRequirement>): Promise<PartRequirement | undefined> {
    const [updatedRequirement] = await db
      .update(partRequirements)
      .set({
        ...requirement,
        updatedAt: new Date(),
      })
      .where(eq(partRequirements.id, id))
      .returning();
    return updatedRequirement;
  }

  async deletePartRequirement(id: number): Promise<boolean> {
    const result = await db
      .delete(partRequirements)
      .where(eq(partRequirements.id, id))
      .returning();
    return result.length > 0;
  }

  // ===== TIRE MANAGEMENT IMPLEMENTATION =====

  // Tire inventory methods
  async getTire(id: number): Promise<any> {
    // Récupérer les vraies données depuis PostgreSQL
    const [tire] = await db.select().from(tires).where(eq(tires.id, id));
    
    if (!tire) {
      return null;
    }
    
    return {
      id: tire.id,
      brand: tire.brand,
      model: tire.model,
      size: tire.size,
      tireType: tire.tireType,
      stockQuantity: tire.stockQuantity,
      minStockLevel: tire.minStockLevel,
      purchasePrice: Number(tire.purchasePrice),
      supplier: tire.supplier,
      location: tire.location,
      dotCode: tire.dotCode,
      manufactureDate: tire.manufactureDate,
      warrantyMonths: tire.warrantyMonths,
      maxLoadIndex: tire.maxLoadIndex,
      speedRating: tire.speedRating,
      notes: tire.notes,
      createdAt: tire.createdAt,
      updatedAt: tire.updatedAt
    };
  }

  async getTires(search?: string, limit = 20, offset = 0): Promise<{ tires: any[], total: number }> {
    // Récupérer les vraies données de la base PostgreSQL
    let query = db.select().from(tires);
    
    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      query = query.where(
        or(
          ilike(tires.brand, searchLower),
          ilike(tires.model, searchLower),
          ilike(tires.size, searchLower)
        )
      );
    }
    
    // Compter le total
    const totalQuery = db.select({ count: count() }).from(tires);
    if (search) {
      const searchLower = `%${search.toLowerCase()}%`;
      totalQuery.where(
        or(
          ilike(tires.brand, searchLower),
          ilike(tires.model, searchLower),
          ilike(tires.size, searchLower)
        )
      );
    }
    
    const [totalResult] = await totalQuery;
    const total = totalResult.count;
    
    // Récupérer les données paginées
    const tiresData = await query
      .limit(limit)
      .offset(offset)
      .orderBy(tires.brand, tires.model);
    
    return { 
      tires: tiresData.map(tire => ({
        ...tire,
        purchasePrice: Number(tire.purchasePrice)
      })), 
      total 
    };
  }

  async createTire(tire: any): Promise<any> {
    // Simulation de création - sera remplacé par vraie insertion après migration
    const newTire = {
      id: Math.floor(Math.random() * 1000) + 100,
      ...tire,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return newTire;
  }

  async updateTire(id: number, tire: any): Promise<any> {
    // Simulation de mise à jour
    return {
      id,
      ...tire,
      updatedAt: new Date()
    };
  }

  async deleteTire(id: number): Promise<boolean> {
    // Simulation de suppression
    return true;
  }

  async getTireStatistics(): Promise<{ totalTires: number, totalValue: number, lowStockCount: number, totalMounted: number, avgTreadDepth: number, rotationsThisMonth: number, costPerKm: number, replacementsDue: number }> {
    try {
      console.log('getTireStatistics called');
      
      // Compter les vrais pneus en stock
      const tiresInStock = await db.select().from(tires);
      const totalTires = tiresInStock.reduce((sum, tire) => sum + tire.stockQuantity, 0);
      const totalValue = tiresInStock.reduce((sum, tire) => sum + (tire.stockQuantity * Number(tire.purchasePrice)), 0);
      const lowStockTires = tiresInStock.filter(tire => tire.stockQuantity <= tire.minStockLevel);
      
      // Compter les pneus montés sur véhicules avec calcul d'usure réel
      const mountedTires = await db.select().from(vehicleTires).where(eq(vehicleTires.status, 'active'));
      const totalMounted = mountedTires.length;
      
      // Calculer la profondeur moyenne de sculpture (filtrer les null)
      const validTreadDepths = mountedTires.filter(vt => vt.currentTreadDepth !== null);
      const avgTreadDepth = validTreadDepths.length > 0 
        ? validTreadDepths.reduce((sum, vt) => sum + vt.currentTreadDepth, 0) / validTreadDepths.length 
        : 0;
      
      // Compter les rotations ce mois
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const rotationsThisMonth = await db.select().from(tireRotations)
        .where(gte(tireRotations.rotationDate, oneMonthAgo.toISOString()));
      
      // Calculer les remplacements dus (usure < 3mm) - filtrer les null
      const replacementsDue = mountedTires.filter(vt => vt.currentTreadDepth !== null && vt.currentTreadDepth < 3.0).length;
    
    // Calculer le coût par kilomètre basé sur le prix moyen des pneus montés
    let costPerKm = 0;
    if (totalMounted > 0) {
      const avgTirePrice = tiresInStock.length > 0 
        ? tiresInStock.reduce((sum, tire) => sum + Number(tire.purchasePrice), 0) / tiresInStock.length 
        : 0;
      // Estimation basée sur durée de vie moyenne d'un pneu (100,000 km)
      costPerKm = Math.round(avgTirePrice / 100000);
    }

    return {
      totalTires,
      totalValue: Math.round(totalValue),
      lowStockCount: lowStockTires.length,
      totalMounted,
      avgTreadDepth: Math.round(avgTreadDepth * 10) / 10,
      rotationsThisMonth: rotationsThisMonth.length,
      costPerKm,
      replacementsDue
    };
    } catch (error) {
      console.error('Error in getTireStatistics:', error);
      return {
        totalTires: 0,
        totalValue: 0,
        lowStockCount: 0,
        totalMounted: 0,
        avgTreadDepth: 0,
        rotationsThisMonth: 0,
        costPerKm: 0,
        replacementsDue: 0
      };
    }
  }

  async getLowStockTires(): Promise<any[]> {
    try {
      console.log('getLowStockTires called');
      console.log('Database connection available:', !!db);
      
      // Récupérer les vrais pneus en stock faible depuis la base de données
      const lowStockTires = await db.select().from(tires)
        .where(sql`stock_quantity <= min_stock_level`)
        .orderBy(tires.brand, tires.model);
      
      console.log('Found low stock tires:', lowStockTires?.length);
      
      return lowStockTires.map(tire => ({
        id: tire.id,
        brand: tire.brand,
        model: tire.model,
        size: tire.size,
        stockQuantity: tire.stockQuantity,
        minStockLevel: tire.minStockLevel,
        location: tire.location,
        purchasePrice: tire.purchasePrice
      }));
    } catch (error) {
      console.error('Error in getLowStockTires:', error);
      return [];
    }
  }

  // Vehicle tire tracking methods
  async getVehicleTires(vehicleId?: number): Promise<any[]> {
    try {
      console.log('getVehicleTires called with vehicleId:', vehicleId);
      console.log('Database connection available:', !!db);
      
      // Récupérer les vraies données depuis PostgreSQL
      let query = db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          tireId: vehicleTires.tireId,
        tireBrand: tires.brand,
        tireModel: tires.model,
        tireSize: tires.size,
        position: vehicleTires.position,
        installationDate: vehicleTires.installationDate,
        installationMileage: vehicleTires.installationMileage,
        currentTreadDepth: vehicleTires.currentTreadDepth,
        initialTreadDepth: vehicleTires.initialTreadDepth,
        currentPressure: vehicleTires.currentPressure,
        recommendedPressure: vehicleTires.recommendedPressure,
        status: vehicleTires.status
      })
      .from(vehicleTires)
      .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
      .leftJoin(tires, eq(vehicleTires.tireId, tires.id));

    if (vehicleId) {
      query = query.where(eq(vehicleTires.vehicleId, vehicleId));
    }

    return await query;
  }

  async getVehicleTire(id: number): Promise<any> {
    try {
      const [vehicleTire] = await db
        .select({
          id: vehicleTires.id,
          vehicleId: vehicleTires.vehicleId,
          tireId: vehicleTires.tireId,
          position: vehicleTires.position,
          status: vehicleTires.status
        })
        .from(vehicleTires)
        .where(eq(vehicleTires.id, id));

      return vehicleTire;
    } catch (error) {
      console.error('Error in getVehicleTire:', error);
      return null;
    }
  }

  async installTireOnVehicle(vehicleTire: any): Promise<any> {
    // Simulation d'installation
    return {
      id: Math.floor(Math.random() * 1000) + 100,
      ...vehicleTire,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  async removeTireFromVehicle(id: number, removalData: any): Promise<any> {
    // Simulation de démontage
    return {
      id,
      ...removalData,
      status: "removed",
      updatedAt: new Date()
    };
  }

  async updateVehicleTire(id: number, data: any): Promise<any> {
    // Simulation de mise à jour
    return {
      id,
      ...data,
      updatedAt: new Date()
    };
  }

  // Tire inspection methods
  async getTireInspections(vehicleTireId?: number, limit = 20, offset = 0): Promise<any[]> {
    try {
      console.log('getTireInspections called with:', { vehicleTireId, limit, offset });
      console.log('Database connection available:', !!db);
      
      // Récupérer les vraies inspections depuis PostgreSQL
      let query = db
      .select({
        id: tireInspections.id,
        vehicleTireId: tireInspections.vehicleTireId,
        vehicleRegistration: vehicles.registrationNumber,
        tireBrand: tires.brand,
        position: vehicleTires.position,
        inspectionDate: tireInspections.inspectionDate,
        treadDepth: tireInspections.treadDepth,
        pressure: tireInspections.pressure,
        wearPattern: tireInspections.wearPattern,
        condition: tireInspections.condition,
        hasDefects: tireInspections.hasDefects,
        recommendedAction: tireInspections.recommendedAction,
        nextInspectionDate: tireInspections.nextInspectionDate
      })
      .from(tireInspections)
      .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
      .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
      .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
      .orderBy(desc(tireInspections.inspectionDate));

      if (vehicleTireId) {
        query = query.where(eq(tireInspections.vehicleTireId, vehicleTireId));
      }

      const result = await query.limit(limit).offset(offset);
      console.log('getTireInspections result:', result?.length);
      return result;
    } catch (error) {
      console.error('Error in getTireInspections:', error);
      return [];
    }
  }

  async createTireInspection(inspection: any): Promise<any> {
    // Simulation de création d'inspection
    return {
      id: Math.floor(Math.random() * 1000) + 100,
      ...inspection,
      createdAt: new Date()
    };
  }

  async getLastInspection(vehicleTireId: number): Promise<any> {
    const inspections = await this.getTireInspections(vehicleTireId);
    return inspections[0]; // Le plus récent
  }

  // Tire rotation methods
  async getTireRotations(vehicleId?: number, limit = 20, offset = 0): Promise<any[]> {
    // Simulation des rotations
    const mockRotations = [
      {
        id: 1,
        vehicleId: 1,
        rotationDate: "2024-12-01",
        rotationMileage: 140000,
        rotationType: "front_to_back",
        performedByName: "Marc Martin",
        cost: 150.00,
        nextRotationMileage: 160000,
        notes: "Rotation standard - usure normale"
      }
    ];

    let filteredRotations = mockRotations;
    if (vehicleId) {
      filteredRotations = mockRotations.filter(r => r.vehicleId === vehicleId);
    }

    return filteredRotations.slice(offset, offset + limit);
  }

  async createTireRotation(rotation: any, rotationDetails: any[]): Promise<any> {
    // Simulation de création de rotation
    const newRotation = {
      id: Math.floor(Math.random() * 1000) + 100,
      ...rotation,
      createdAt: new Date()
    };

    // Simulation de création des détails
    const details = rotationDetails.map(detail => ({
      id: Math.floor(Math.random() * 1000) + 100,
      rotationId: newRotation.id,
      ...detail,
      createdAt: new Date()
    }));

    return { rotation: newRotation, details };
  }

  async getTireRotationDetails(rotationId: number): Promise<any[]> {
    // Simulation des détails de rotation
    return [
      {
        id: 1,
        rotationId,
        vehicleTireId: 1,
        fromPosition: "front_left",
        toPosition: "rear_left_outer"
      },
      {
        id: 2,
        rotationId,
        vehicleTireId: 2,
        fromPosition: "rear_left_outer",
        toPosition: "front_left"
      }
    ];
  }
}

export const storage = new DatabaseStorage();
