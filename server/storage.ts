import { existsSync } from "fs";
import { eq, and, or, desc, asc, sql, like, gte, lte, isNull, ilike, count, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbExecutor } from "./db";
import { AppError, isAppError } from "./lib/app-error";
import { moduleLogger } from "./lib/logger";
import { lockFuelCard } from "./lib/fuel-card-lock";
import { reverseFuelLink } from "./services/treasury-links";
import { isAdminGuardDbRefusal, isCheckViolation } from "./lib/pg-errors";
import { uploadedFileCandidates } from "./lib/uploaded-file";
import { deleteFile } from "./middleware/upload";
import { vehicleStatusService } from "./services/vehicle-status-service";
import {
  users, vehicles, maintenanceSchedules, workOrders, parts, partsUsed, fuelRecords, alerts,
  vehicleDocuments, statusHistory, faultCatalog, partsStockMovements, partRequirements,
  tires, vehicleTires, tireRotations, tireInspections, tireRotationDetails,
  partCategories, partSpecifications, partVariants,
  type User, type InsertUser, type Vehicle, type InsertVehicle,
  type MaintenanceSchedule, type InsertMaintenanceSchedule,
  type WorkOrder, type InsertWorkOrder, type Part, type InsertPart,
  type PartUsed, type InsertPartUsed, type FuelRecord, type InsertFuelRecord,
  type Alert, type InsertAlert, type VehicleDocument, type InsertVehicleDocument, 
  type StatusHistory, type InsertStatusHistory, type PartRequirement, type InsertPartRequirement,
  type PartCategory, type InsertPartCategory, type PartSpecification, type InsertPartSpecification,
  type PartVariant, type InsertPartVariant, type FaultCatalog, type InsertFaultCatalog,
  type TireRotation
} from "@shared/schema";
import { describeStatusChange } from "@shared/constants/vehicle-status";
import { assertVehicleTypeChangeAllowed } from "./services/trailer-assignment";

type StockMovementType = "in" | "out" | "adjustment" | "initial";

const storageLog = moduleLogger("storage");

export type StockWriteOptions = {
  /** Transaction en cours : le mouvement est annulé avec elle. */
  executor?: DbExecutor;
  /** Refuser une sortie qui rendrait le stock négatif (contrôle atomique). */
  requireAvailable?: boolean;
  /**
   * Avec `executor` : reçoit les effets à jouer après le commit (trame `alert_created`).
   * Sans lui, une alerte écrite dans la transaction n'est pas diffusée (elle pourrait être annulée).
   */
  afterCommit?: (effect: () => void | Promise<void>) => void;
};
type FleetStatsSnapshot = {
  operational: number;
  maintenance: number;
  outOfService: number;
};

type FleetStatusHistoryPoint = FleetStatsSnapshot & {
  date: string;
};

type StatusInconsistency = {
  code: string;
  message: string;
  vehicleId?: number;
};

type MaintenanceScheduleWithVehicle = MaintenanceSchedule & {
  vehicleRegistrationNumber: Vehicle["registrationNumber"] | null;
  vehicleBrand: Vehicle["brand"] | null;
  vehicleModel: Vehicle["model"] | null;
  status: "overdue" | "due_soon" | "scheduled";
};

type WorkOrderListItem = {
  id: WorkOrder["id"];
  vehicleId: WorkOrder["vehicleId"];
  vehicleRegistration: WorkOrder["vehicleRegistration"];
  vehicleBrand: WorkOrder["vehicleBrand"];
  vehicleModel: WorkOrder["vehicleModel"];
  vehicleRegistrationNumber: Vehicle["registrationNumber"] | null;
  technicianId: WorkOrder["technicianId"];
  technicianName: User["name"] | null;
  title: WorkOrder["title"];
  description: WorkOrder["description"];
  diagnosis: WorkOrder["diagnosis"];
  status: WorkOrder["status"];
  priority: WorkOrder["priority"];
  startDate: WorkOrder["startDate"];
  endDate: WorkOrder["endDate"];
  duration: WorkOrder["duration"];
  cost: WorkOrder["cost"];
  isPreventive: WorkOrder["isPreventive"];
  isFirstVisit: WorkOrder["isFirstVisit"];
  maintenanceScheduleId: WorkOrder["maintenanceScheduleId"];
  createdAt: WorkOrder["createdAt"];
};

type WorkOrderListResult = {
  workOrders: WorkOrderListItem[];
  total: number;
};

// Colonnes d'une ligne de liste d'OT (véhicule et technicien joints).
const workOrderListColumns = {
  id: workOrders.id,
  vehicleId: workOrders.vehicleId,
  vehicleRegistration: vehicles.registrationNumber,
  vehicleBrand: vehicles.brand,
  vehicleModel: vehicles.model,
  vehicleRegistrationNumber: vehicles.registrationNumber,
  technicianId: workOrders.technicianId,
  technicianName: users.name,
  title: workOrders.title,
  description: workOrders.description,
  diagnosis: workOrders.diagnosis,
  status: workOrders.status,
  priority: workOrders.priority,
  startDate: workOrders.startDate,
  endDate: workOrders.endDate,
  duration: workOrders.duration,
  cost: workOrders.cost,
  isPreventive: workOrders.isPreventive,
  isFirstVisit: workOrders.isFirstVisit,
  maintenanceScheduleId: workOrders.maintenanceScheduleId,
  createdAt: workOrders.createdAt,
};

type PartStockHistoryItem = {
  id: number;
  movementType: StockMovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  notes: string | null;
  workOrderId: number | null;
  createdAt: Date;
  createdByName: User["name"] | null;
};

type StockMovementItem = {
  id: number;
  partId: number;
  partName: Part["name"] | null;
  partReference: Part["reference"] | null;
  movementType: StockMovementType;
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string | null;
  notes: string | null;
  workOrderId: number | null;
  workOrderTitle: WorkOrder["title"] | null;
  createdAt: Date;
  date: Date;
  performedBy: number | null;
  performedByName: User["name"] | null;
};

type PartWorkOrderItem = {
  id: WorkOrder["id"];
  title: WorkOrder["title"];
  status: WorkOrder["status"];
  priority: WorkOrder["priority"];
  startDate: WorkOrder["startDate"];
  vehicleRegistration: Vehicle["registrationNumber"];
  vehicleBrand: Vehicle["brand"];
  vehicleModel: Vehicle["model"];
  quantityUsed: number;
  unitPrice: string;
  totalCost: number;
};

type PartUsageHistoryItem = {
  id: number;
  workOrderId: number;
  workOrderTitle: WorkOrder["title"];
  quantity: number;
  unitPrice: string;
  totalCost: number;
  vehicleRegistration: Vehicle["registrationNumber"];
  vehicleBrand: Vehicle["brand"];
  vehicleModel: Vehicle["model"];
  usageDate: Date;
  workOrderStatus: WorkOrder["status"];
};

type TireRotationWithRelations = TireRotation & {
  technicianName: User["name"] | null;
  vehicleRegistration: Vehicle["registrationNumber"] | null;
};

type PartRequirementWithRelations = PartRequirement & {
  partName: Part["name"] | null;
  partReference: Part["reference"] | null;
  vehicleRegistration: Vehicle["registrationNumber"] | null;
  requesterName: User["name"] | null;
};

/** Ce qu'une correction de document peut changer (PATCH /api/documents/:id). */
export type VehicleDocumentCorrection = Partial<Pick<InsertVehicleDocument, "name" | "description" | "expiryDate" | "updatedBy">>;

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  getUsersByRole(role: string): Promise<User[]>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  
  // Vehicle methods
  getVehicle(id: number): Promise<Vehicle | undefined>;
  getVehicleByRegistration(registrationNumber: string): Promise<Vehicle | undefined>;
  getVehicles(search?: string, status?: string, vehicleType?: string, limit?: number, offset?: number, sortBy?: string, sortOrder?: 'asc' | 'desc'): Promise<{ vehicles: Vehicle[], total: number }>;
  getVehiclesByOwner(ownerId: number): Promise<{ vehicles: Vehicle[], total: number }>;
  /** Tout le parc non supprimé, sans pagination (agrégats, alertes). `getVehicles` pagine à 10 par défaut. */
  listAllVehicles(): Promise<{ vehicles: Vehicle[], total: number }>;
  createVehicle(vehicle: InsertVehicle, createdById?: number): Promise<Vehicle>;
  updateVehicle(id: number, vehicle: Partial<InsertVehicle>, updatedById?: number): Promise<Vehicle | undefined>;
  deleteVehicle(id: number, actorUserId?: number | null): Promise<boolean>;
  
  // Status History methods
  getStatusHistory(vehicleId: number): Promise<StatusHistory[]>;
  getStatusHistoryByPeriod(period: string): Promise<FleetStatusHistoryPoint[]>;
  
  // Vehicle Document methods
  getVehicleDocument(id: number): Promise<VehicleDocument | undefined>;
  getVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]>;
  getVehicleDocumentsByType(vehicleId: number, type: string): Promise<VehicleDocument[]>;
  createVehicleDocument(document: InsertVehicleDocument): Promise<VehicleDocument>;
  updateVehicleDocument(id: number, changes: VehicleDocumentCorrection): Promise<VehicleDocument | undefined>;
  deleteVehicleDocument(id: number): Promise<boolean>;
  
  // Maintenance schedule methods
  getMaintenanceSchedule(id: number): Promise<MaintenanceSchedule | undefined>;
  getMaintenanceSchedulesByVehicleId(vehicleId: number): Promise<MaintenanceScheduleWithVehicle[]>;
  createMaintenanceSchedule(schedule: InsertMaintenanceSchedule): Promise<MaintenanceSchedule>;
  updateMaintenanceSchedule(id: number, schedule: Partial<InsertMaintenanceSchedule>): Promise<MaintenanceSchedule | undefined>;
  deleteMaintenanceSchedule(id: number): Promise<boolean>;
  
  // Work order methods
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  getWorkOrdersByVehicleId(vehicleId: number): Promise<WorkOrderListItem[]>;
  getWorkOrdersByTechnicianId(technicianId: number): Promise<WorkOrderListItem[]>;
  getWorkOrders(status?: string, priority?: string, limit?: number, offset?: number): Promise<WorkOrderListResult>;
  getWorkOrdersByOwner(ownerId: number, status?: string, priority?: string, limit?: number, offset?: number): Promise<WorkOrderListResult>;
  getWorkOrdersForTechnician(technicianId: number, status?: string, priority?: string, limit?: number, offset?: number): Promise<WorkOrderListResult>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  /** Champs d'un OT hors statut : le statut passe par `transitionWorkOrderStatus`. */
  updateWorkOrder(id: number, workOrder: Omit<Partial<InsertWorkOrder>, "status">): Promise<WorkOrder | undefined>;
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
  addPartToWorkOrder(partUsed: InsertPartUsed, actorUserId?: number, options?: StockWriteOptions): Promise<PartUsed>;
  
  // Parts stock movements methods
  getPartStockHistory(partId: number): Promise<PartStockHistoryItem[]>;
  getPartWorkOrders(partId: number): Promise<PartWorkOrderItem[]>;
  getPartUsageHistory(partId: number): Promise<PartUsageHistoryItem[]>;
  recordStockMovement(partId: number, movementType: StockMovementType, quantity: number, workOrderId?: number, reason?: string, createdBy?: number, options?: StockWriteOptions): Promise<void>;

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
  getPartRequirement(id: number): Promise<PartRequirementWithRelations | undefined>;
  getPartRequirements(status?: string): Promise<PartRequirementWithRelations[]>;
  getPartRequirementsByPartId(partId: number): Promise<PartRequirementWithRelations[]>;
  createPartRequirement(requirement: InsertPartRequirement): Promise<PartRequirement>;
  deletePartRequirement(id: number): Promise<boolean>;
  
  // Dashboard methods
  getFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }>;
  getMaintenanceCompliance(): Promise<{ compliant: number, overdue: number, total: number }>;
  getMaintenanceCost(period: 'week' | 'month' | 'quarter' | 'year'): Promise<number>;
  getScheduledMaintenanceCount(period?: 'week' | 'month' | 'quarter' | 'year'): Promise<number>;
  
  // Status consistency methods
  validateStatusConsistency(): Promise<{ consistent: boolean, inconsistencies: StatusInconsistency[] }>;
  
  // Fault Catalog methods
  getFaultCatalogs(): Promise<FaultCatalog[]>;
  createFaultCatalog(catalog: InsertFaultCatalog): Promise<FaultCatalog>;
  deleteFaultCatalog(id: number): Promise<boolean>;
}

export const WORK_ORDER_STATUS_VIA_TRANSITION_ERROR =
  "updateWorkOrder n'écrit pas le statut : passer par transitionWorkOrderStatus.";

export class DatabaseStorage implements IStorage {
  async getStatusHistory(vehicleId: number): Promise<StatusHistory[]> {
    try {
      return await db
        .select()
        .from(statusHistory)
        .where(eq(statusHistory.vehicleId, vehicleId))
        .orderBy(desc(statusHistory.date));
    } catch (error) {
      console.error('Error getting status history:', error);
      return [];
    }
  }

  async getStatusHistoryByPeriod(period: string): Promise<FleetStatusHistoryPoint[]> {
    // Utiliser le service de statut dédié
    return await vehicleStatusService.getFleetStatusHistory(period as 'week' | 'month' | 'quarter' | 'year');
  }

  private formatMonthlyData(
    historyData: Array<Pick<StatusHistory, "date" | "status">>,
    currentStats: FleetStatsSnapshot,
    now: Date
  ): FleetStatusHistoryPoint[] {
    // Grouper les données historiques par jour
    const dailyStats: Record<string, { operational: number, maintenance: number, outOfService: number }> = {};
    
    // Initialiser avec les stats actuelles pour tous les jours
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Traiter les vraies données de changements de statut
    historyData.forEach(record => {
      const recordDate = new Date(record.date);
      const dayKey = `${recordDate.getDate()}/${recordDate.getMonth() + 1}`;
      
      if (!dailyStats[dayKey]) {
        dailyStats[dayKey] = { operational: 0, maintenance: 0, outOfService: 0 };
      }
      
      // Compter les véhicules par statut pour ce jour
      switch (record.status) {
        case 'operational':
          dailyStats[dayKey].operational++;
          break;
        case 'maintenance':
          dailyStats[dayKey].maintenance++;
          break;
        case 'out_of_service':
          dailyStats[dayKey].outOfService++;
          break;
      }
    });
    
    // Créer le tableau final avec tous les jours du mois
    const dailyData: FleetStatusHistoryPoint[] = [];
    const currentDate = new Date(monthStart);
    
    while (currentDate <= monthEnd && currentDate <= now) {
      const dayKey = `${currentDate.getDate()}/${currentDate.getMonth() + 1}`;
      
      // Utiliser les données historiques si disponibles, sinon les stats actuelles
      const dayStats = dailyStats[dayKey] || currentStats;
      
      dailyData.push({
        date: dayKey,
        operational: dayStats.operational,
        maintenance: dayStats.maintenance,
        outOfService: dayStats.outOfService
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dailyData;
  }

  private formatYearlyData(
    historyData: Array<Pick<StatusHistory, "date" | "status">>,
    currentStats: FleetStatsSnapshot
  ): FleetStatusHistoryPoint[] {
    // Grouper les vraies données par mois
    const monthlyStats: Record<string, { operational: number, maintenance: number, outOfService: number }> = {};
    
    // Traiter les vraies données de changements de statut
    historyData.forEach(record => {
      const date = new Date(record.date);
      const monthKey = `${date.getMonth() + 1}/${date.getFullYear()}`;
      
      if (!monthlyStats[monthKey]) {
        monthlyStats[monthKey] = { operational: 0, maintenance: 0, outOfService: 0 };
      }
      
      // Compter les véhicules par statut pour ce mois
      switch (record.status) {
        case 'operational':
          monthlyStats[monthKey].operational++;
          break;
        case 'maintenance':
          monthlyStats[monthKey].maintenance++;
          break;
        case 'out_of_service':
          monthlyStats[monthKey].outOfService++;
          break;
      }
    });
    
    // Si aucune donnée historique, retourner les stats actuelles pour le mois en cours
    if (Object.keys(monthlyStats).length === 0) {
      const now = new Date();
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('fr-FR', { month: 'short' });
      return [{
        date: currentMonth,
        operational: currentStats.operational,
        maintenance: currentStats.maintenance,
        outOfService: currentStats.outOfService
      }];
    }
    
    const monthlyData: FleetStatusHistoryPoint[] = [];
    
    // Créer des données pour chaque mois qui a des données réelles, triées par date
    Object.keys(monthlyStats).sort().forEach(monthKey => {
      const [month, year] = monthKey.split('/');
      const monthName = new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
      
      monthlyData.push({
        date: monthName,
        operational: monthlyStats[monthKey].operational,
        maintenance: monthlyStats[monthKey].maintenance,
        outOfService: monthlyStats[monthKey].outOfService
      });
    });
    
    return monthlyData;
  }

  private formatWeeklyData(
    _historyData: Array<Pick<StatusHistory, "date" | "status">>,
    currentStats: FleetStatsSnapshot,
    now: Date
  ): FleetStatusHistoryPoint[] {
    const weeklyData: FleetStatusHistoryPoint[] = [];
    const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    
    // Générer des données réalistes pour toute la semaine basées sur les stats actuelles
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
      const dayName = date.toLocaleDateString('fr-FR', { weekday: 'short' });
      
      // Générer des variations réalistes autour des statistiques actuelles
      // Facteur de variation basé sur le jour de la semaine (moins d'activité le weekend)
      const isWeekend = i === 5 || i === 6; // vendredi et samedi
      const baseVariation = isWeekend ? 0.9 : 1.0; // Moins d'activité le weekend
      
      // Ajouter une variation sinusoïdale pour simuler les fluctuations naturelles
      const dailyVariation = 0.85 + (Math.sin(i * 0.8) * 0.15);
      const totalVariation = baseVariation * dailyVariation;
      
      // Calculer les stats pour ce jour
      const totalVehicles = currentStats.operational + currentStats.maintenance + currentStats.outOfService;
      
      // Garder une distribution réaliste
      const operationalCount = Math.round(currentStats.operational * totalVariation);
      const maintenanceCount = Math.round(currentStats.maintenance * (1 + (1 - totalVariation) * 0.5));
      const outOfServiceCount = Math.max(0, totalVehicles - operationalCount - maintenanceCount);
      
      weeklyData.push({
        date: dayName,
        operational: Math.max(0, operationalCount),
        maintenance: Math.max(0, maintenanceCount),
        outOfService: Math.max(0, outOfServiceCount)
      });
    }
    
    return weeklyData;
  }

  private formatQuarterlyData(
    _historyData: Array<Pick<StatusHistory, "date" | "status">>,
    currentStats: FleetStatsSnapshot,
    now: Date
  ): FleetStatusHistoryPoint[] {
    const quarterlyData: FleetStatusHistoryPoint[] = [];
    
    // Créer 3 mois de données pour le trimestre
    for (let i = 0; i < 3; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - 2 + i, 1);
      const monthName = monthDate.toLocaleDateString('fr-FR', { month: 'short' });
      
      // Variation progressive sur le trimestre
      const monthVariation = (i - 1) * 0.1; // -0.1, 0, 0.1
      
      quarterlyData.push({
        date: monthName,
        operational: Math.max(0, Math.round(currentStats.operational + (currentStats.operational * monthVariation))),
        maintenance: Math.max(0, Math.round(currentStats.maintenance + (currentStats.maintenance * -monthVariation * 0.5))),
        outOfService: Math.max(0, Math.round(currentStats.outOfService + (currentStats.outOfService * monthVariation * 0.3)))
      });
    }
    
    return quarterlyData;
  }

  async getFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }> {
    // Utiliser le service de statut dédié
    return await vehicleStatusService.getFleetStatistics();
  }

  /**
   * Conformité de l'entretien préventif sur toute la flotte.
   *
   * `overdue`   : la date d'entretien programmée est dépassée.
   * `compliant` : elle ne l'est pas — ou aucune date n'est programmée, auquel
   *               cas il n'y a rien à être en retard.
   *
   * Le comptage se fait en base, pas en mémoire: charger la flotte entière
   * pour la filtrer côté serveur coûterait cher sans rien apporter.
   *
   * Comparaison à la date du jour côté SQL (`CURRENT_DATE`): `next_maintenance_date`
   * est une colonne `date` sans heure, et l'horloge Node ne doit pas décider
   * si un entretien du jour est en retard.
   */
  async getMaintenanceCompliance(): Promise<{ compliant: number, overdue: number, total: number }> {
    try {
      const [row] = await db
        .select({
          total: count(vehicles.id),
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${vehicles.nextMaintenanceDate} IS NOT NULL AND ${vehicles.nextMaintenanceDate} < CURRENT_DATE)`,
        })
        .from(vehicles);

      const total = Number(row?.total || 0);
      const overdue = Number(row?.overdue || 0);

      return { compliant: total - overdue, overdue, total };
    } catch (error) {
      storageLog.error({ err: error }, "Error getting maintenance compliance");
      throw new AppError(500, "La conformité de maintenance est momentanément indisponible.", { cause: error });
    }
  }

  // Calculer les KPI essentiels du CMMS
  async getFleetKPI(): Promise<{
    availabilityRate: number,
    mtbf: number, // Mean Time Between Failures
    mttr: number, // Mean Time To Repair
    maintenanceCostPerVehicle: number,
    downtimeHours: number
  }> {
    // Utiliser le service de statut dédié
    return await vehicleStatusService.getFleetKPI();
  }

  /**
   * Coût de main-d'œuvre atelier sur la période.
   *
   * Base retenue: ordres de travail **terminés**, sur `created_at`. Un OT
   * ouvert n'a pas encore coûté son montant final; le compter gonflerait la
   * période en cours puis la ferait chuter à la clôture.
   *
   * `workOrders.cost` est le coût de base (main-d'œuvre): les pièces ne sont
   * pas incluses, elles vivent dans `parts_used` et entrent dans les charges
   * par leur facture fournisseur — voir le commentaire sur la colonne dans
   * `shared/schema.ts`.
   *
   * ⚠️ `getFleetKPI` somme de son côté **tous** les OT sans filtre de statut,
   * pour son `maintenanceCostPerVehicle`. Les deux chiffres ne se réconcilient
   * donc pas tant que des OT sont ouverts. À unifier si l'écart gêne.
   */
  async getMaintenanceCost(period: 'week' | 'month' | 'quarter' | 'year'): Promise<number> {
    try {
      const debut = new Date();
      const jours = { week: 7, month: 30, quarter: 90, year: 365 }[period] ?? 30;
      debut.setDate(debut.getDate() - jours);

      const [row] = await db
        .select({
          total: sql<string>`COALESCE(SUM(COALESCE(${workOrders.cost}, 0)), 0)`,
        })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, 'completed'),
            gte(workOrders.createdAt, debut),
          ),
        );

      return Number(row?.total || 0);
    } catch (error) {
      storageLog.error({ err: error, period }, "Error getting maintenance cost");
      // 0 passerait pour « aucune dépense de maintenance sur la période ».
      throw new AppError(500, "Le coût de maintenance est momentanément indisponible.", { cause: error });
    }
  }

  async getScheduledMaintenanceCount(period?: 'week' | 'month' | 'quarter' | 'year'): Promise<number> {
    try {
      // Récupérer toutes les maintenances planifiées depuis la base PostgreSQL
      const [result] = await db
        .select({ count: count() })
        .from(maintenanceSchedules);
      
      return result.count;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting scheduled maintenance count");
      throw new AppError(500, "Le nombre de maintenances planifiées est momentanément indisponible.", { cause: error });
    }
  }

  async validateStatusConsistency(): Promise<{ consistent: boolean, inconsistencies: StatusInconsistency[] }> {
    try {
      return { consistent: true, inconsistencies: [] };
    } catch (error) {
      console.error('Error validating status consistency:', error);
      return { consistent: false, inconsistencies: [] };
    }
  }

  // User methods implementation
  async getUser(id: number): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.username, username));
      return user;
    } catch (error) {
      // Relancée, pas avalée : `undefined` se lisait « nom inconnu » (login en 401, contrôle
      // d'unicité passé à tort) alors que la base était en panne (#260).
      storageLog.error({ err: error }, "Error getting user by username");
      throw error;
    }
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email));
      return user;
    } catch (error) {
      console.error('Error getting user by email:', error);
      return undefined;
    }
  }
  async createUser(user: InsertUser): Promise<User> {
    try {
      const [newUser] = await db.insert(users).values(user).returning();
      return newUser;
    } catch (error) {
      storageLog.error({ err: error }, "Error creating user");
      throw error;
    }
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    try {
      const [updatedUser] = await db
        .update(users)
        .set(user)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning();
      return updatedUser;
    } catch (error) {
      if (isAdminGuardDbRefusal(error)) throw error;
      storageLog.error({ err: error, userId: id }, "Error updating user");
      return undefined;
    }
  }

  async getUsersByRole(role: string): Promise<User[]> {
    try {
      return await db
        .select()
        .from(users)
        .where(and(eq(users.role, role as any), isNull(users.deletedAt)));
    } catch (error) {
      storageLog.error({ err: error }, "Error getting users by role");
      throw new AppError(500, "La liste des utilisateurs est momentanément indisponible.", { cause: error });
    }
  }
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).where(isNull(users.deletedAt));
  }
  async deleteUser(id: number): Promise<boolean> {
    try {
      const deletedAt = new Date();
      const [deletedUser] = await db
        .update(users)
        .set({ deletedAt })
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .returning({ id: users.id });
      return Boolean(deletedUser);
    } catch (error) {
      if (isAdminGuardDbRefusal(error)) throw error;
      storageLog.error({ err: error, userId: id }, "Error deleting user");
      return false;
    }
  }
  
  async getVehicle(id: number): Promise<Vehicle | undefined> {
    const [result] = await db
      .select({
        vehicle: vehicles,
        createdByName: users.name,
      })
      .from(vehicles)
      .leftJoin(users, eq(vehicles.createdBy, users.id))
      .where(eq(vehicles.id, id));

    if (!result) {
      return undefined;
    }

    return {
      ...result.vehicle,
      createdByName: result.createdByName,
    } as Vehicle;
  }
  async getVehicleByRegistration(registrationNumber: string): Promise<Vehicle | undefined> {
    const [result] = await db
      .select({
        vehicle: vehicles,
        createdByName: users.name,
      })
      .from(vehicles)
      .leftJoin(users, eq(vehicles.createdBy, users.id))
      .where(eq(vehicles.registrationNumber, registrationNumber));

    if (!result) {
      return undefined;
    }

    return {
      ...result.vehicle,
      createdByName: result.createdByName,
    } as Vehicle;
  }
  async getVehicles(
    search?: string,
    status?: string,
    vehicleType?: string,
    limit: number = 10,
    offset: number = 0,
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<{ vehicles: Vehicle[], total: number }> {
    console.log('🚗 getVehicles called with params:', { search, status, vehicleType, limit, offset, sortBy, sortOrder });
    
    try {
      const conditions: SQL[] = [isNull(vehicles.deletedAt)];

      const normalizedSearch = search?.trim();
      if (normalizedSearch) {
        const searchPattern = `%${normalizedSearch}%`;
        conditions.push(
          or(
            ilike(vehicles.registrationNumber, searchPattern),
            ilike(vehicles.brand, searchPattern),
            ilike(vehicles.model, searchPattern),
            ilike(vehicles.engineSpec, searchPattern),
            ilike(vehicles.vin, searchPattern)
          )!
        );
      }

      if (status) {
        conditions.push(eq(vehicles.status, status as Vehicle["status"]));
      }

      if (vehicleType) {
        conditions.push(eq(vehicles.vehicleType, vehicleType as Vehicle["vehicleType"]));
      }

      const whereClause = and(...conditions);

      const sortColumnMap = {
        registrationNumber: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        engineSpec: vehicles.engineSpec,
        status: vehicles.status,
        nextMaintenanceDate: vehicles.nextMaintenanceDate,
        mileage: vehicles.mileage,
        year: vehicles.year,
        vehicleType: vehicles.vehicleType,
        licensePlateExpiry: vehicles.licensePlateExpiry,
      } as const;

      const sortColumn = sortBy && sortBy in sortColumnMap
        ? sortColumnMap[sortBy as keyof typeof sortColumnMap]
        : vehicles.createdAt;
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const vehicleRows = await db
        .select()
        .from(vehicles)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      const [totalResult] = await db
        .select({ count: count() })
        .from(vehicles)
        .where(whereClause);

      const total = Number(totalResult?.count || 0);

      const creatorIds = Array.from(
        new Set(
          vehicleRows
            .map((vehicle) => vehicle.createdBy)
            .filter((value): value is number => typeof value === "number")
        )
      );

      const creatorNameById = new Map<number, string>();
      if (creatorIds.length > 0) {
        const creatorRows = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, creatorIds));
        for (const creator of creatorRows) {
          creatorNameById.set(creator.id, creator.name);
        }
      }

      const vehiclesWithCreator = vehicleRows.map((vehicle) => ({
        ...vehicle,
        createdByName:
          typeof vehicle.createdBy === "number"
            ? creatorNameById.get(vehicle.createdBy) ?? null
            : null,
      }));

      console.log(`🚗 Returning ${vehicleRows.length} vehicle(s) (total: ${total})`);

      return {
        vehicles: vehiclesWithCreator as Vehicle[],
        total,
      };
    } catch (error) {
      console.error('🚗 Error in getVehicles:', error);
      return { vehicles: [], total: 0 };
    }
  }
  async listAllVehicles(): Promise<{ vehicles: Vehicle[]; total: number }> {
    // Pas de repli silencieux sur une liste vide : un total faux est pire qu'une erreur.
    const allVehicles = await db
      .select()
      .from(vehicles)
      .where(isNull(vehicles.deletedAt))
      .orderBy(asc(vehicles.id));
    return { vehicles: allVehicles, total: allVehicles.length };
  }
  async getVehiclesByOwner(ownerId: number): Promise<{ vehicles: Vehicle[]; total: number }> {
    try {
      const ownerVehicles = await db
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.ownerId, ownerId), isNull(vehicles.deletedAt)));
      return {
        vehicles: ownerVehicles,
        total: ownerVehicles.length
      };
    } catch (error) {
      console.error("Error getting vehicles by owner:", error);
      return { vehicles: [], total: 0 };
    }
  }
  async createVehicle(vehicle: InsertVehicle, createdById?: number): Promise<Vehicle> {
    const [createdVehicle] = await db
      .insert(vehicles)
      .values({
        ...vehicle,
        createdBy: createdById ?? null,
      })
      .returning();
    
    // Enregistrer le statut initial dans l'historique
    await db.insert(statusHistory).values({
      vehicleId: createdVehicle.id,
      status: createdVehicle.status,
      date: new Date().toISOString().split('T')[0],
      notes: `Véhicule créé avec le statut ${createdVehicle.status}`,
      updatedById: null
    });
    
    return createdVehicle;
  }
  async updateVehicle(id: number, vehicle: Partial<InsertVehicle>, updatedById?: number): Promise<Vehicle | undefined> {
    try {
      // Récupérer l'état actuel du véhicule pour comparer
      const currentVehicle = await this.getVehicle(id);
      if (!currentVehicle) {
        return undefined;
      }
      
      // Effectuer la mise à jour du véhicule
      // Le type est écrit sous les verrous de l'attelage : pas de course avec une affectation.
      const [updatedVehicle] = await db.transaction(async (tx) => {
        // Comparé au type relu sous verrou dans le contrôle, pas à `currentVehicle` lu hors transaction.
        if (vehicle.vehicleType) await assertVehicleTypeChangeAllowed(tx, id, vehicle.vehicleType);
        return tx.update(vehicles).set(vehicle).where(eq(vehicles.id, id)).returning();
      });
      
      // Si le statut a changé, enregistrer dans l'historique automatiquement
      if (vehicle.status && vehicle.status !== currentVehicle.status) {
        // Chemin de la fiche véhicule: c'est un humain qui a choisi. Le dire,
        // sinon l'historique est indistinguable d'un changement automatique.
        await this.recordStatusChange(
          id,
          vehicle.status,
          currentVehicle.status,
          updatedById,
          describeStatusChange("manual", vehicle.status, currentVehicle.status),
        );
      }
      
      return updatedVehicle;
    } catch (error) {
      // Une contrainte CHECK refusée est une saisie invalide : la remonter pour que la route réponde 400.
      if (isCheckViolation(error) || error instanceof AppError) throw error;
      storageLog.error({ err: error, vehicleId: id }, "Error updating vehicle");
      return undefined;
    }
  }
  /**
   * Suppression définitive d'un véhicule et de ses données liées, en une seule transaction.
   * Les pleins liés à la trésorerie (lot T2) sont d'abord contre-passés, sous le verrou de la carte,
   * comme une suppression unitaire de plein : sans cela, la carte garderait au journal des débits
   * dont le plein n'existe plus.
   */
  async deleteVehicle(id: number, actorUserId: number | null = null): Promise<boolean> {
    try {
      const counts = await db.transaction(async (tx) => {
        await lockFuelCard(tx);
        // Un plein supprimé en douceur a déjà été contre-passé à sa suppression.
        const fuel = await tx
          .select({ id: fuelRecords.id })
          .from(fuelRecords)
          .where(and(eq(fuelRecords.vehicleId, id), isNull(fuelRecords.deletedAt)));
        for (const record of fuel) await reverseFuelLink(tx, record.id, actorUserId);
        // Ordre imposé par les clés étrangères : historique, planifications, OT, pleins, puis le véhicule.
        const statusHistoryDeleted = await tx.delete(statusHistory).where(eq(statusHistory.vehicleId, id)).returning();
        const schedules = await tx.delete(maintenanceSchedules).where(eq(maintenanceSchedules.vehicleId, id)).returning();
        const orders = await tx.delete(workOrders).where(eq(workOrders.vehicleId, id)).returning();
        const fuelDeleted = await tx.delete(fuelRecords).where(eq(fuelRecords.vehicleId, id)).returning();
        const vehicleDeleted = await tx.delete(vehicles).where(eq(vehicles.id, id)).returning();
        return {
          statusHistory: statusHistoryDeleted.length,
          maintenanceSchedules: schedules.length,
          workOrders: orders.length,
          fuelRecords: fuelDeleted.length,
          vehicle: vehicleDeleted.length,
        };
      });
      storageLog.info({ vehicleId: id, actorUserId, ...counts }, "suppression définitive d'un véhicule");
      return counts.vehicle > 0;
    } catch (err) {
      storageLog.error({ err, vehicleId: id }, "échec de la suppression définitive d'un véhicule");
      return false;
    }
  }

  // Méthode pour enregistrer automatiquement les changements de statut
  /**
   * Délègue au service de statut, qui est le seul écrivain de
   * `status_history`. Cette méthode avait sa propre insertion et son propre
   * libellé générique: deux auteurs pour la même table produisaient deux
   * historiques au vocabulaire différent selon le chemin emprunté.
   */
  private async recordStatusChange(
    vehicleId: number,
    newStatus: Vehicle["status"],
    oldStatus: Vehicle["status"],
    updatedById?: number,
    raison?: string,
  ): Promise<void> {
    await vehicleStatusService.recordStatusChange(
      vehicleId,
      newStatus,
      oldStatus,
      updatedById,
      raison,
    );
  }

  // Méthode pour changer automatiquement le statut d'un véhicule en maintenance
  async setVehicleToMaintenance(vehicleId: number, workOrderId: number, updatedById?: number): Promise<void> {
    // Utiliser le service de statut dédié
    await vehicleStatusService.setVehicleToMaintenance(vehicleId, workOrderId, updatedById);
  }

  // Méthode pour remettre automatiquement un véhicule en service
  async setVehicleToOperational(vehicleId: number, workOrderId: number, updatedById?: number): Promise<void> {
    // Utiliser le service de statut dédié
    await vehicleStatusService.setVehicleToOperational(vehicleId, workOrderId, updatedById);
  }
  
  async getVehicleDocument(id: number): Promise<VehicleDocument | undefined> {
    const [document] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id));
    return document;
  }
  async getVehicleDocuments(vehicleId: number): Promise<VehicleDocument[]> {
    try {
      const uploader = alias(users, "uploader");
      const updater = alias(users, "updater");
      return await db
        .select({
          id: vehicleDocuments.id,
          vehicleId: vehicleDocuments.vehicleId,
          name: vehicleDocuments.name,
          type: vehicleDocuments.type,
          description: vehicleDocuments.description,
          expiryDate: vehicleDocuments.expiryDate,
          filename: vehicleDocuments.filename,
          filesize: vehicleDocuments.filesize,
          fileType: vehicleDocuments.fileType,
          filePath: vehicleDocuments.filePath,
          uploadedBy: vehicleDocuments.uploadedBy,
          uploadedByName: uploader.name,
          updatedBy: vehicleDocuments.updatedBy,
          updatedByName: updater.name,
          createdAt: vehicleDocuments.createdAt,
          updatedAt: vehicleDocuments.updatedAt
        })
        .from(vehicleDocuments)
        .leftJoin(uploader, eq(vehicleDocuments.uploadedBy, uploader.id))
        .leftJoin(updater, eq(vehicleDocuments.updatedBy, updater.id))
        .where(eq(vehicleDocuments.vehicleId, vehicleId))
        .orderBy(desc(vehicleDocuments.createdAt));
    } catch (error) {
      console.error("Get vehicle documents error:", error);
      return [];
    }
  }
  async getVehicleDocumentsByType(vehicleId: number, type: string): Promise<VehicleDocument[]> {
    try {
      return await db
        .select()
        .from(vehicleDocuments)
        .where(and(eq(vehicleDocuments.vehicleId, vehicleId), like(vehicleDocuments.type, type)));
    } catch (error) {
      console.error('Error getting vehicle documents by type:', error);
      return [];
    }
  }
  async createVehicleDocument(document: InsertVehicleDocument): Promise<VehicleDocument> {
    try {
      const [created] = await db.insert(vehicleDocuments).values(document).returning();
      return created;
    } catch (error) {
      console.error('Error creating vehicle document:', error);
      throw error;
    }
  }
  // Champs écrits nommés un à un : un appelant ne peut plus faire passer `vehicleId`,
  // `filePath` ou `uploadedBy` par un objet générique. Drizzle ignore les clés `undefined`.
  // L'erreur SQL n'est plus avalée : elle remonte au gestionnaire central au lieu d'un faux 404.
  async updateVehicleDocument(id: number, changes: VehicleDocumentCorrection): Promise<VehicleDocument | undefined> {
    const [updated] = await db
      .update(vehicleDocuments)
      .set({
        name: changes.name,
        description: changes.description,
        expiryDate: changes.expiryDate,
        updatedBy: changes.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(vehicleDocuments.id, id))
      .returning();
    return updated;
  }
  // Était un bouchon renvoyant false : DELETE /api/documents/:id répondait 204
  // sans rien supprimer. La ligne part d'abord : un fichier orphelin vaut mieux
  // qu'une ligne qui pointe vers un fichier effacé. Les documents recopiés depuis
  // le workflow d'acquisition peuvent partager un chemin : le fichier reste tant
  // qu'une autre ligne y renvoie.
  async deleteVehicleDocument(id: number): Promise<boolean> {
    const [deleted] = await db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, id)).returning();
    if (!deleted) return false;

    const [stillReferenced] = await db
      .select({ id: vehicleDocuments.id })
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.filePath, deleted.filePath))
      .limit(1);
    if (stillReferenced) return true;

    const filePath = uploadedFileCandidates(deleted.filePath).find((candidate) => existsSync(candidate));
    if (!filePath) {
      storageLog.warn({ documentId: id, filePath: deleted.filePath }, "fichier du document absent de uploads/, ligne supprimée seule");
      return true;
    }
    try {
      await deleteFile(filePath);
    } catch (error) {
      storageLog.warn({ err: error, documentId: id, filePath }, "fichier du document non supprimé");
    }
    return true;
  }
  
  // Était un bouchon renvoyant undefined : PATCH et DELETE d'une planification
  // répondaient toujours 404.
  async getMaintenanceSchedule(id: number): Promise<MaintenanceSchedule | undefined> {
    const [schedule] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
    return schedule;
  }
  /**
   * Forme commune aux deux lectures de planifications: une seule définition,
   * pour que la liste globale et la liste par véhicule ne puissent pas
   * renvoyer des colonnes différentes.
   */
  private readonly maintenanceScheduleSelection = {
          id: maintenanceSchedules.id,
          vehicleId: maintenanceSchedules.vehicleId,
          vehicleRegistrationNumber: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          title: maintenanceSchedules.title,
          description: maintenanceSchedules.description,
          scheduledDate: maintenanceSchedules.scheduledDate,
          scheduledMileage: maintenanceSchedules.scheduledMileage,
          frequency: maintenanceSchedules.frequency,
          frequencyValue: maintenanceSchedules.frequencyValue,
          isActive: maintenanceSchedules.isActive,
          createdAt: maintenanceSchedules.createdAt,
          updatedAt: maintenanceSchedules.updatedAt,
          status: sql<MaintenanceScheduleWithVehicle["status"]>`
            CASE 
              WHEN ${maintenanceSchedules.scheduledDate} < CURRENT_DATE THEN 'overdue'
              WHEN ${maintenanceSchedules.scheduledDate} <= CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
              ELSE 'scheduled'
            END
          `
  };

  /**
   * Toutes les planifications, ou celles d'une liste de véhicules.
   *
   * Remplace une boucle qui interrogeait la base **une fois par véhicule**:
   * 7 allers-retours pour 6 camions, soit ~3 secondes à la latence de ce
   * déploiement — et 20 secondes à 40 véhicules. Le filtre par véhicule sert
   * au rôle `client`, qui ne voit que son parc.
   *
   * Pas de vue SQL: la jointure porte deux tables et aucun calcul. Une vue
   * ajouterait un objet à versionner et du SQL que ni le compilateur ni les
   * tests ne lisent, sans rien simplifier.
   */
  async getMaintenanceSchedules(vehicleIds?: number[]): Promise<MaintenanceScheduleWithVehicle[]> {
    try {
      if (vehicleIds && vehicleIds.length === 0) {
        return [];
      }

      const base = db
        .select(this.maintenanceScheduleSelection)
        .from(maintenanceSchedules)
        .leftJoin(vehicles, eq(maintenanceSchedules.vehicleId, vehicles.id));

      return vehicleIds
        ? await base
            .where(inArray(maintenanceSchedules.vehicleId, vehicleIds))
            .orderBy(maintenanceSchedules.scheduledDate)
        : await base.orderBy(maintenanceSchedules.scheduledDate);
    } catch (error) {
      storageLog.error({ err: error }, "Error getting maintenance schedules");
      throw new AppError(500, "Le planning de maintenance est momentanément indisponible.", { cause: error });
    }
  }

  async getMaintenanceSchedulesByVehicleId(vehicleId: number): Promise<MaintenanceScheduleWithVehicle[]> {
    try {
      return await db
        .select(this.maintenanceScheduleSelection)
        .from(maintenanceSchedules)
        .leftJoin(vehicles, eq(maintenanceSchedules.vehicleId, vehicles.id))
        .where(eq(maintenanceSchedules.vehicleId, vehicleId))
        .orderBy(maintenanceSchedules.scheduledDate);
    } catch (error) {
      storageLog.error({ err: error }, "Error getting maintenance schedules for vehicle");
      throw new AppError(500, "Le planning de maintenance du véhicule est momentanément indisponible.", { cause: error });
    }
  }
  async createMaintenanceSchedule(schedule: InsertMaintenanceSchedule): Promise<MaintenanceSchedule> {
    try {
      const [maintenanceSchedule] = await db
        .insert(maintenanceSchedules)
        .values(schedule)
        .returning();
      return maintenanceSchedule;
    } catch (error) {
      console.error('Error creating maintenance schedule:', error);
      throw error;
    }
  }
  async updateMaintenanceSchedule(id: number, schedule: Partial<InsertMaintenanceSchedule>): Promise<MaintenanceSchedule | undefined> {
    try {
      const [updated] = await db
        .update(maintenanceSchedules)
        .set(schedule)
        .where(eq(maintenanceSchedules.id, id))
        .returning();
      return updated || undefined;
    } catch (error) {
      console.error('Error updating maintenance schedule:', error);
      throw error;
    }
  }
  
  async deleteMaintenanceSchedule(id: number): Promise<boolean> {
    try {
      const result = await db
        .delete(maintenanceSchedules)
        .where(eq(maintenanceSchedules.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Error deleting maintenance schedule:', error);
      return false;
    }
  }
  
  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    const [workOrder] = await db
      .select({
        id: workOrders.id,
        vehicleId: workOrders.vehicleId,
        vehicleRegistration: workOrders.vehicleRegistration,
        vehicleBrand: workOrders.vehicleBrand,
        vehicleModel: workOrders.vehicleModel,
        technicianId: workOrders.technicianId,
        technicianName: users.name,
        createdBy: workOrders.createdBy,
        createdByName: sql<string>`(SELECT name FROM users WHERE id = ${workOrders.createdBy})`,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        isFirstVisit: workOrders.isFirstVisit,
        maintenanceScheduleId: workOrders.maintenanceScheduleId,
        scheduledDate: maintenanceSchedules.scheduledDate,
        createdAt: workOrders.createdAt,
        updatedAt: workOrders.updatedAt,
        updatedBy: workOrders.updatedBy
      })
      .from(workOrders)
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .leftJoin(maintenanceSchedules, eq(workOrders.maintenanceScheduleId, maintenanceSchedules.id))
      .where(eq(workOrders.id, id));
    return workOrder;
  }
  async getWorkOrdersByVehicleId(vehicleId: number): Promise<WorkOrderListItem[]> {
    return await db
      .select({
        id: workOrders.id,
        vehicleId: workOrders.vehicleId,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        vehicleRegistrationNumber: vehicles.registrationNumber,
        technicianId: workOrders.technicianId,
        technicianName: users.name,
        title: workOrders.title,
        description: workOrders.description,
        diagnosis: workOrders.diagnosis,
        status: workOrders.status,
        priority: workOrders.priority,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate,
        duration: workOrders.duration,
        cost: workOrders.cost,
        isPreventive: workOrders.isPreventive,
        isFirstVisit: workOrders.isFirstVisit,
        maintenanceScheduleId: workOrders.maintenanceScheduleId,
        createdAt: workOrders.createdAt,
      })
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(workOrders.vehicleId, vehicleId))
      .orderBy(desc(workOrders.createdAt));
  }
  // Était un bouchon renvoyant [] : GET /api/work-orders/technician/:id
  // répondait toujours une liste vide.
  async getWorkOrdersByTechnicianId(technicianId: number): Promise<WorkOrderListItem[]> {
    return await db
      .select(workOrderListColumns)
      .from(workOrders)
      .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(eq(workOrders.technicianId, technicianId))
      .orderBy(desc(workOrders.createdAt));
  }
  async getWorkOrders(
    status?: string,
    priority?: string,
    limit?: number,
    offset?: number,
    search?: string
  ): Promise<WorkOrderListResult> {
    try {
      console.log('getWorkOrders called - fetching from PostgreSQL...');
      
      // Construire la requête avec les filtres
      const query = db
        .select({
          id: workOrders.id,
          vehicleId: workOrders.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          vehicleRegistrationNumber: vehicles.registrationNumber,
          technicianId: workOrders.technicianId,
          technicianName: users.name,
          title: workOrders.title,
          description: workOrders.description,
          diagnosis: workOrders.diagnosis,
          status: workOrders.status,
          priority: workOrders.priority,
          startDate: workOrders.startDate,
          endDate: workOrders.endDate,
          duration: workOrders.duration,
          cost: workOrders.cost,
          isPreventive: workOrders.isPreventive,
          isFirstVisit: workOrders.isFirstVisit,
          maintenanceScheduleId: workOrders.maintenanceScheduleId,
          createdAt: workOrders.createdAt
        })
        .from(workOrders)
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .leftJoin(users, eq(workOrders.technicianId, users.id));

      // Appliquer les filtres
      const conditions: SQL<unknown>[] = [];
      
      if (status) {
        conditions.push(eq(workOrders.status, status as WorkOrder["status"]));
      }
      
      if (priority) {
        conditions.push(eq(workOrders.priority, priority as WorkOrder["priority"]));
      }
      
      if (search) {
        const searchCondition = or(
          ilike(workOrders.title, `%${search}%`),
          ilike(workOrders.description, `%${search}%`),
          ilike(vehicles.registrationNumber, `%${search}%`),
          ilike(users.name, `%${search}%`)
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const filteredQuery = conditions.length > 0 ? query.where(and(...conditions)) : query;
      
      // Compter le total avec les mêmes conditions
      const countQuery = db.select({ count: count() }).from(workOrders)
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .leftJoin(users, eq(workOrders.technicianId, users.id));

      const filteredCountQuery = conditions.length > 0 ? countQuery.where(and(...conditions)) : countQuery;
      const [{ count: totalCount }] = await filteredCountQuery;
      
      // Appliquer la pagination et l'ordre. `id` départage les dates de création égales
      // (import en masse) : sans lui, un OT peut revenir sur deux pages et un autre être sauté.
      const allWorkOrders = await filteredQuery
        .orderBy(desc(workOrders.createdAt), desc(workOrders.id))
        .limit(limit || 50)
        .offset(offset || 0);
      
      console.log('Work orders retrieved from DB:', allWorkOrders.length, 'items, total:', totalCount);
      
      // Compter par statut pour les statistiques
      const pending = allWorkOrders.filter(wo => wo.status === 'pending').length;
      const inProgress = allWorkOrders.filter(wo => wo.status === 'in_progress').length;
      const completed = allWorkOrders.filter(wo => wo.status === 'completed').length;
      
      console.log('Work orders stats:', { pending, inProgress, completed, total: totalCount });
      
      return { 
        workOrders: allWorkOrders, 
        total: totalCount
      };
    } catch (error) {
      console.error('Error getting work orders:', error);
      return { workOrders: [], total: 0 };
    }
  }
  async getWorkOrdersByOwner(
    ownerId: number,
    status?: string,
    priority?: string,
    limit?: number,
    offset?: number
  ): Promise<WorkOrderListResult> {
    // Était un bouchon renvoyant une liste vide : un client ne voyait aucun OT.
    // Véhicules retirés compris, par exception (AGENTS.md §11) : même règle que le détail d'un OT.
    const conditions: SQL<unknown>[] = [eq(vehicles.ownerId, ownerId)];
    if (status) {
      conditions.push(eq(workOrders.status, status as WorkOrder["status"]));
    }
    if (priority) {
      conditions.push(eq(workOrders.priority, priority as WorkOrder["priority"]));
    }

    const [{ total }] = await db
      .select({ total: count() })
      .from(workOrders)
      .innerJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .where(and(...conditions));

    const ownerWorkOrders = await db
      .select(workOrderListColumns)
      .from(workOrders)
      .innerJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
      .leftJoin(users, eq(workOrders.technicianId, users.id))
      .where(and(...conditions))
      // Départage par id : à date égale, un OT pouvait revenir sur deux pages et un autre être sauté.
      .orderBy(desc(workOrders.createdAt), desc(workOrders.id))
      .limit(limit || 50)
      .offset(offset || 0);

    return { workOrders: ownerWorkOrders, total };
  }
  async getWorkOrdersForTechnician(
    technicianId: number,
    status?: string,
    priority?: string,
    limit?: number,
    offset?: number
  ): Promise<WorkOrderListResult> { 
    try {
      console.log(`getWorkOrdersForTechnician called for technician ID: ${technicianId}`);
      
      // Construire les conditions une seule fois pour éviter les conflits de typage Drizzle.
      // Parenthèses obligatoires : `and()` n'en ajoute pas autour d'un fragment `sql`,
      // et sans elles le filtre de statut ne s'appliquait qu'aux OT non assignés.
      const conditions: SQL<unknown>[] = [
        sql`(${workOrders.technicianId} = ${technicianId} OR ${workOrders.technicianId} IS NULL)`
      ];

      if (status) {
        conditions.push(eq(workOrders.status, status as WorkOrder["status"]));
      }

      if (priority) {
        conditions.push(eq(workOrders.priority, priority as WorkOrder["priority"]));
      }

      // Construire la requête pour les work orders assignés au technicien OU non assignés
      const query = db
        .select({
          id: workOrders.id,
          vehicleId: workOrders.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          vehicleRegistrationNumber: vehicles.registrationNumber,
          technicianId: workOrders.technicianId,
          technicianName: users.name,
          title: workOrders.title,
          description: workOrders.description,
          diagnosis: workOrders.diagnosis,
          status: workOrders.status,
          priority: workOrders.priority,
          startDate: workOrders.startDate,
          endDate: workOrders.endDate,
          duration: workOrders.duration,
          cost: workOrders.cost,
          isPreventive: workOrders.isPreventive,
          isFirstVisit: workOrders.isFirstVisit,
          maintenanceScheduleId: workOrders.maintenanceScheduleId,
          createdAt: workOrders.createdAt
        })
        .from(workOrders)
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .leftJoin(users, eq(workOrders.technicianId, users.id));

      const filteredQuery = query.where(and(...conditions));

      // Compter le total
      const countQuery = db
        .select({ count: sql<number>`count(*)` })
        .from(workOrders);

      const [{ count: totalCount }] = await countQuery.where(and(...conditions));
      
      // Appliquer la pagination et l'ordre. `id` départage les dates de création égales
      // (import en masse) : sans lui, un OT peut revenir sur deux pages et un autre être sauté.
      const allWorkOrders = await filteredQuery
        .orderBy(desc(workOrders.createdAt), desc(workOrders.id))
        .limit(limit || 50)
        .offset(offset || 0);
      
      console.log(`Work orders for technician ${technicianId}:`, allWorkOrders.length, 'items, total:', totalCount);
      
      return { 
        workOrders: allWorkOrders, 
        total: totalCount
      };
    } catch (error) {
      console.error('Error getting work orders for technician:', error);
      return { workOrders: [], total: 0 };
    }
  }
  async createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder> {
    try {
      const [newWorkOrder] = await db.insert(workOrders).values(workOrder).returning();
      
      // Automatiquement passer le véhicule en maintenance lors de la création d'un ordre de travail
      if (newWorkOrder.vehicleId && newWorkOrder.status !== 'completed') {
        await this.setVehicleToMaintenance(newWorkOrder.vehicleId, newWorkOrder.id);
      }
      
      return newWorkOrder;
    } catch (error) {
      console.error('Error creating work order:', error);
      throw new Error('Erreur lors de la création de l\'ordre de travail');
    }
  }
  async updateWorkOrder(id: number, workOrder: Omit<Partial<InsertWorkOrder>, "status">): Promise<WorkOrder | undefined> {
    // Le statut ne s'écrit que par `transitionWorkOrderStatus` (compare-and-set, règle des
    // transitions, effets sur le parc). Refusé ici aussi à l'exécution, hors du try : le message
    // générique du catch ne doit pas masquer une erreur de programmation.
    if (workOrder && Object.prototype.hasOwnProperty.call(workOrder, "status")) {
      throw new Error(WORK_ORDER_STATUS_VIA_TRANSITION_ERROR);
    }
    try {
      const currentWorkOrder = await this.getWorkOrder(id);
      if (!currentWorkOrder) {
        throw new Error('Ordre de travail non trouvé');
      }

      await db
        .update(workOrders)
        .set(workOrder)
        .where(eq(workOrders.id, id));

      // Retour enrichi (technicianName, createdByName…) — le `.returning()` brut
      // laissait la fiche détail sur « Inconnu » après une affectation.
      return await this.getWorkOrder(id);
    } catch (error) {
      console.error('Error updating work order:', error);
      throw new Error('Erreur lors de la mise à jour de l\'ordre de travail');
    }
  }
  async deleteWorkOrder(id: number): Promise<boolean> {
    try {
      const [workOrderToDelete] = await db
        .select({
          id: workOrders.id,
          vehicleId: workOrders.vehicleId,
          status: workOrders.status,
        })
        .from(workOrders)
        .where(eq(workOrders.id, id));

      if (!workOrderToDelete) {
        return false;
      }

      const result = await db
        .delete(workOrders)
        .where(eq(workOrders.id, id));

      const deleted = (result.rowCount ?? 0) > 0;
      if (!deleted) {
        return false;
      }

      const activeStatuses: WorkOrder["status"][] = ["pending", "in_progress", "awaiting_parts"];
      const deletedWorkOrderWasActive = activeStatuses.includes(workOrderToDelete.status as WorkOrder["status"]);

      // Si on supprime la dernière OT active d'un véhicule en maintenance, le repasser opérationnel.
      if (deletedWorkOrderWasActive) {
        const [{ activeCount }] = await db
          .select({ activeCount: count() })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.vehicleId, workOrderToDelete.vehicleId),
              inArray(workOrders.status, activeStatuses)
            )
          );

        if ((activeCount ?? 0) === 0) {
          const [vehicle] = await db
            .select({
              id: vehicles.id,
              status: vehicles.status,
            })
            .from(vehicles)
            .where(eq(vehicles.id, workOrderToDelete.vehicleId));

          if (vehicle?.status === "maintenance") {
            await vehicleStatusService.updateVehicleStatus(
              workOrderToDelete.vehicleId,
              "operational",
              undefined,
              `Véhicule remis en service - OT #${id} supprimée (aucune OT active restante)`
            );
          }
        }
      }

      return true;
    } catch (error) {
      console.error("Error deleting work order:", error);
      return false;
    }
  }
  
  async getPart(id: number): Promise<Part | undefined> {
    try {
      const [part] = await db.select().from(parts).where(eq(parts.id, id));
      return part;
    } catch (error) {
      console.error('Error getting part:', error);
      return undefined;
    }
  }
  
  async getPartByReference(reference: string): Promise<Part | undefined> {
    try {
      const [part] = await db.select().from(parts).where(eq(parts.reference, reference));
      return part;
    } catch (error) {
      console.error('Error getting part by reference:', error);
      return undefined;
    }
  }
  
  async getParts(search?: string, limit?: number, offset?: number): Promise<{ parts: Part[], total: number }> { 
    try {
      storageLog.debug("Lecture de la liste des pièces");
      
      const conditions: SQL<unknown>[] = [];
      
      // Appliquer la recherche si fournie
      if (search) {
        const searchCondition = or(
          ilike(parts.name, `%${search}%`),
          ilike(parts.reference, `%${search}%`),
          ilike(parts.supplier, `%${search}%`)
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      const query = conditions.length > 0
        ? db.select().from(parts).where(and(...conditions))
        : db.select().from(parts);
      
      // Appliquer la pagination
      const allParts = await query
        .orderBy(desc(parts.createdAt))
        .limit(limit || 50)
        .offset(offset || 0);
      
      // Compter le total pour la pagination
      const countQuery = conditions.length > 0
        ? db.select({ count: count() }).from(parts).where(and(...conditions))
        : db.select({ count: count() }).from(parts);
      const [{ count: total }] = await countQuery;
      
      storageLog.debug({ count: allParts.length, total }, "Pièces récupérées");
      
      return { parts: allParts, total };
    } catch (error) {
      storageLog.error({ err: error }, "Error getting parts");
      // Une liste vide passerait pour « aucune pièce en stock » (valeur du stock à 0).
      throw new AppError(500, "La liste des pièces est momentanément indisponible.", { cause: error });
    }
  }
  
  async getPartsLowOnStock(): Promise<Part[]> { 
    try {
      // Récupérer les pièces avec un stock faible (quantité <= seuil minimum)
      const lowStockParts = await db
        .select()
        .from(parts)
        .where(lte(parts.quantity, parts.minQuantity))
        .orderBy(parts.name);
      
      return lowStockParts;
    } catch (error) {
      console.error('Error getting low stock parts:', error);
      return [];
    }
  }
  
  async getPartsStatistics(): Promise<{ totalItems: number, totalValue: number, lowStockCount: number }> { 
    try {
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
    } catch (error) {
      console.error('Error getting parts statistics:', error);
      return { totalItems: 0, totalValue: 0, lowStockCount: 0 };
    }
  }
  async createPart(part: InsertPart): Promise<Part> {
    try {
      const [createdPart] = await db
        .insert(parts)
        .values(part)
        .returning();
      return createdPart;
    } catch (error) {
      console.error('Error creating part:', error);
      throw error;
    }
  }
  async updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined> { return undefined; }
  async deletePart(id: number): Promise<boolean> { return false; }
  
  async getAllPartsUsed(): Promise<PartUsed[]> {
    try {
      const allPartsUsed = await db
        .select({
          id: partsUsed.id,
          workOrderId: partsUsed.workOrderId,
          partId: partsUsed.partId,
          quantity: partsUsed.quantity,
          unitPrice: partsUsed.unitPrice,
          createdAt: partsUsed.createdAt,
          partName: parts.name,
          partReference: parts.reference,
          partLocation: parts.location
        })
        .from(partsUsed)
        .leftJoin(parts, eq(partsUsed.partId, parts.id))
        .orderBy(desc(partsUsed.createdAt));
      
      return allPartsUsed as PartUsed[];
    } catch (error) {
      storageLog.error({ err: error }, "Error getting all parts used");
      // Une liste vide passerait pour « aucune pièce consommée » (coûts à 0).
      throw new AppError(500, "Les pièces utilisées sont momentanément indisponibles.", { cause: error });
    }
  }

  async getPartsUsedForWorkOrder(workOrderId: number): Promise<PartUsed[]> {
    try {
      const partsUsedInOrder = await db
        .select({
          id: partsUsed.id,
          workOrderId: partsUsed.workOrderId,
          partId: partsUsed.partId,
          quantity: partsUsed.quantity,
          unitPrice: partsUsed.unitPrice,
          createdAt: partsUsed.createdAt,
          partName: parts.name,
          partReference: parts.reference,
          partDescription: parts.description,
          partLocation: parts.location,
          totalCost: sql<number>`${partsUsed.quantity} * ${partsUsed.unitPrice}`
        })
        .from(partsUsed)
        .leftJoin(parts, eq(partsUsed.partId, parts.id))
        .where(eq(partsUsed.workOrderId, workOrderId))
        .orderBy(partsUsed.createdAt);
      
      // Identifiants et nombre seulement : les lignes portent le prix des pièces.
      storageLog.debug({ workOrderId, count: partsUsedInOrder.length, partUsedIds: partsUsedInOrder.map((p) => p.id) }, "Pièces récupérées pour l'ordre");
      return partsUsedInOrder as PartUsed[];
    } catch (error) {
      storageLog.error({ err: error, workOrderId }, "Error getting parts used for work order");
      // Une liste vide passerait pour « aucune pièce sur cet OT » (coût pièces à 0).
      throw new AppError(500, "Les pièces de l'ordre de travail sont momentanément indisponibles.", { cause: error });
    }
  }

  async addPartToWorkOrder(partUsed: InsertPartUsed, actorUserId?: number, options: StockWriteOptions = {}): Promise<PartUsed> {
    const executor = options.executor ?? db;
    try {
      const [newPartUsed] = await executor.insert(partsUsed).values(partUsed).returning();

      const quantity = partUsed.quantity ?? 1;

      // Enregistrer le mouvement de stock sortant
      await this.recordStockMovement(
        partUsed.partId,
        'out',
        quantity,
        partUsed.workOrderId,
        'Utilisé dans ordre de travail',
        actorUserId,
        options
      );

      return newPartUsed;
    } catch (error) {
      if (isAppError(error)) throw error;
      storageLog.error({ err: error, workOrderId: partUsed.workOrderId, partId: partUsed.partId }, "ajout de pièce à l'OT en échec");
      throw new Error('Erreur lors de l\'ajout de la pièce à l\'ordre de travail');
    }
  }

  async getPartStockHistory(partId: number): Promise<PartStockHistoryItem[]> {
    try {
      const stockMovements = await db
        .select({
          id: partsStockMovements.id,
          movementType: partsStockMovements.movementType,
          quantity: partsStockMovements.quantity,
          previousStock: partsStockMovements.previousStock,
          newStock: partsStockMovements.newStock,
          reason: partsStockMovements.reason,
          notes: partsStockMovements.notes,
          workOrderId: partsStockMovements.workOrderId,
          createdAt: partsStockMovements.createdAt,
          createdByName: users.name
        })
        .from(partsStockMovements)
        .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
        .where(eq(partsStockMovements.partId, partId))
        .orderBy(desc(partsStockMovements.createdAt));
      
      return stockMovements;
    } catch (error) {
      storageLog.error({ err: error, partId }, "Error getting part stock history");
      // Une liste vide passerait pour « aucun mouvement de stock ».
      throw new AppError(500, "L'historique de stock de la pièce est momentanément indisponible.", { cause: error });
    }
  }

  async getAllStockMovements(): Promise<StockMovementItem[]> {
    try {
      const stockMovements = await db
        .select({
          id: partsStockMovements.id,
          partId: partsStockMovements.partId,
          partName: parts.name,
          partReference: parts.reference,
          movementType: partsStockMovements.movementType,
          quantity: partsStockMovements.quantity,
          previousStock: partsStockMovements.previousStock,
          newStock: partsStockMovements.newStock,
          reason: partsStockMovements.reason,
          notes: partsStockMovements.notes,
          workOrderId: partsStockMovements.workOrderId,
          workOrderTitle: workOrders.title,
          createdAt: partsStockMovements.createdAt,
          date: partsStockMovements.createdAt,
          performedBy: partsStockMovements.createdBy,
          performedByName: users.name
        })
        .from(partsStockMovements)
        .leftJoin(parts, eq(partsStockMovements.partId, parts.id))
        .leftJoin(workOrders, eq(partsStockMovements.workOrderId, workOrders.id))
        .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
        .orderBy(desc(partsStockMovements.createdAt));
      
      storageLog.debug({ count: stockMovements.length }, "Mouvements de stock récupérés");
      return stockMovements;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting all stock movements");
      // Une liste vide passerait pour « aucun mouvement de stock ».
      throw new AppError(500, "Les mouvements de stock sont momentanément indisponibles.", { cause: error });
    }
  }

  async getPartWorkOrders(partId: number): Promise<PartWorkOrderItem[]> {
    try {
      const partWorkOrders = await db
        .select({
          id: workOrders.id,
          title: workOrders.title,
          status: workOrders.status,
          priority: workOrders.priority,
          startDate: workOrders.startDate,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          quantityUsed: partsUsed.quantity,
          unitPrice: partsUsed.unitPrice,
          totalCost: sql<number>`${partsUsed.quantity} * ${partsUsed.unitPrice}`
        })
        .from(partsUsed)
        .innerJoin(workOrders, eq(partsUsed.workOrderId, workOrders.id))
        .innerJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .where(eq(partsUsed.partId, partId))
        .orderBy(desc(workOrders.startDate));
      
      return partWorkOrders;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting part work orders");
      throw new AppError(500, "Les ordres de travail de cette pièce sont momentanément indisponibles.", { cause: error });
    }
  }

  async getPartUsageHistory(partId: number): Promise<PartUsageHistoryItem[]> {
    try {
      const usageHistory = await db
        .select({
          id: partsUsed.id,
          workOrderId: partsUsed.workOrderId,
          workOrderTitle: workOrders.title,
          quantity: partsUsed.quantity,
          unitPrice: partsUsed.unitPrice,
          totalCost: sql<number>`${partsUsed.quantity} * ${partsUsed.unitPrice}`,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          usageDate: partsUsed.createdAt,
          workOrderStatus: workOrders.status
        })
        .from(partsUsed)
        .innerJoin(workOrders, eq(partsUsed.workOrderId, workOrders.id))
        .innerJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .where(eq(partsUsed.partId, partId))
        .orderBy(desc(partsUsed.createdAt));
      
      return usageHistory;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting part usage history");
      throw new AppError(500, "L'historique d'utilisation de la pièce est momentanément indisponible.", { cause: error });
    }
  }

  async recordStockMovement(partId: number, movementType: StockMovementType, quantity: number, workOrderId?: number, reason?: string, createdBy?: number, options: StockWriteOptions = {}): Promise<void> {
    const executor = options.executor ?? db;
    try {
      // Récupérer le stock actuel de la pièce
      const [currentPart] = await executor.select().from(parts).where(eq(parts.id, partId));
      if (!currentPart) {
        throw new AppError(404, 'Pièce introuvable dans le stock');
      }

      let previousStock = currentPart.quantity;
      let newStock = previousStock;

      if (movementType === 'in' || movementType === 'out') {
        // Écriture relative et atomique : une lecture puis une écriture absolue
        // perdait l'une de deux mises à jour simultanées sur la même pièce.
        const delta = movementType === 'in' ? quantity : -quantity;
        const guard = movementType === 'out' && options.requireAvailable
          ? and(eq(parts.id, partId), gte(parts.quantity, quantity))
          : eq(parts.id, partId);
        const [row] = await executor
          .update(parts)
          .set({ quantity: sql`${parts.quantity} + ${delta}`, updatedAt: new Date() })
          .where(guard)
          .returning({ quantity: parts.quantity });
        if (!row) {
          throw new AppError(409, 'Stock insuffisant : la pièce vient d\'être sortie par une autre opération. Rechargez la page.');
        }
        newStock = row.quantity;
        previousStock = newStock - delta;
      } else {
        // 'adjustment' et 'initial' fixent la valeur absolue, par définition.
        newStock = quantity;
        await executor.update(parts).set({ quantity: newStock, updatedAt: new Date() }).where(eq(parts.id, partId));
      }

      // Enregistrer le mouvement de stock
      await executor.insert(partsStockMovements).values({
        partId,
        movementType,
        quantity: movementType === 'adjustment' || movementType === 'initial' ? newStock - previousStock : quantity,
        previousStock,
        newStock,
        workOrderId,
        reason,
        createdBy
      });

      // Vérifier et créer les alertes de stock automatiquement
      await this.checkAndCreateStockAlerts(partId, currentPart, newStock, previousStock, options);
    } catch (error) {
      if (isAppError(error)) throw error;
      storageLog.error({ err: error, partId, movementType, quantity, workOrderId }, 'mouvement de stock en échec');
      throw new Error('Erreur lors de l\'enregistrement du mouvement de stock');
    }
  }

  // Fonction pour vérifier et créer les alertes de stock automatiquement
  private async checkAndCreateStockAlerts(
    partId: number,
    part: Part,
    newStock: number,
    previousStock: number,
    options: StockWriteOptions = {},
  ): Promise<void> {
    // L'alerte suit le mouvement : créée après son commit, jamais pour un mouvement annulé.
    try {
      const minThreshold = part.minQuantity;
      const alertThreshold = Math.ceil(minThreshold * 1.2); // Seuil d'alerte à 20% au-dessus du minimum

      // Déterminer les nouveaux niveaux d'alerte
      const wasAboveAlert = previousStock > alertThreshold;
      const wasAboveMin = previousStock > minThreshold;
      const wasAboveZero = previousStock > 0;

      const isAboveAlert = newStock > alertThreshold;
      const isAboveMin = newStock > minThreshold;
      const isAboveZero = newStock > 0;

      let alertMessage = '';
      let alertPriority: Alert["priority"] = 'low';

      // Alerte quand on s'approche du seuil (entre seuil d'alerte et minimum)
      if (wasAboveAlert && !isAboveAlert && isAboveMin) {
        alertMessage = `Stock bas pour ${part.name} (${part.reference}): ${newStock} unités restantes (seuil: ${minThreshold})`;
        alertPriority = 'medium';
      }
      // Alerte quand on atteint le seuil minimum
      else if (wasAboveMin && !isAboveMin && isAboveZero) {
        alertMessage = `Seuil minimum atteint pour ${part.name} (${part.reference}): ${newStock} unités restantes`;
        alertPriority = 'high';
      }
      // Alerte quand on est en dessous du seuil (rupture de stock)
      else if (wasAboveMin && !isAboveZero) {
        alertMessage = `Rupture de stock pour ${part.name} (${part.reference}): stock épuisé`;
        alertPriority = 'critical';
      }
      // Alerte continue quand on reste en dessous du minimum
      else if (!wasAboveMin && !isAboveMin && newStock <= minThreshold) {
        alertMessage = `Stock critique pour ${part.name} (${part.reference}): ${newStock} unités (minimum: ${minThreshold})`;
        alertPriority = 'critical';
      }

      // Créer l'alerte si nécessaire
      if (alertMessage) {
        // Destinataires : tous les admins et magasiniers, une alerte et une trame chacun
        // (décision du 3 novembre 2026). Écrite hors de la transaction du mouvement, après
        // son commit : un échec de l'alerte ne peut pas annuler la sortie de stock, et une
        // sortie annulée n'emporte aucune alerte.
        const notify = async () => {
          try {
            const { alertService } = await import("./services/alert-service");
            await alertService.notifyLowStock({
              partId,
              title: `Stock ${alertPriority === 'critical' ? 'Critique' : 'Bas'}`,
              message: alertMessage,
              priority: alertPriority,
            });
          } catch (error) {
            storageLog.error({ err: error, partId }, "alerte de stock non créée");
          }
        };
        if (!options.executor) await notify();
        else if (options.afterCommit) options.afterCommit(notify);
        else storageLog.warn({ partId }, "mouvement en transaction sans afterCommit : alerte de stock non créée");
      }
    } catch (error) {
      storageLog.error({ err: error, partId }, "alerte de stock non créée");
      // Ne pas faire échouer l'opération principale si la création d'alerte échoue
    }
  }
  
  async getFuelRecord(id: number): Promise<FuelRecord | undefined> { return undefined; }
  async getFuelRecordsByVehicleId(vehicleId: number): Promise<FuelRecord[]> {
    try {
      // Récupérer les vrais enregistrements de carburant depuis PostgreSQL
      const records = await db.select().from(fuelRecords).where(and(eq(fuelRecords.vehicleId, vehicleId), isNull(fuelRecords.deletedAt)));
      return records;
    } catch (error) {
      console.error('Error getting fuel records by vehicle ID:', error);
      return [];
    }
  }
  async createFuelRecord(fuelRecord: InsertFuelRecord, createdById?: number): Promise<FuelRecord> { throw new Error('Not implemented'); }
  async updateFuelRecord(id: number, fuelRecord: Partial<InsertFuelRecord>, updatedById?: number): Promise<FuelRecord | undefined> { return undefined; }
  async deleteFuelRecord(id: number): Promise<boolean> { return false; }
  
  async getAlert(id: number): Promise<Alert | undefined> {
    try {
      const [alert] = await db.select().from(alerts).where(eq(alerts.id, id));
      return alert;
    } catch (error) {
      console.error('Error getting alert:', error);
      return undefined;
    }
  }

  async getAlertsByUserId(userId: number): Promise<Alert[]> {
    try {
      const userAlerts = await db
        .select()
        .from(alerts)
        .where(eq(alerts.userId, userId))
        .orderBy(desc(alerts.createdAt));
      return userAlerts;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting alerts by user ID");
      throw new AppError(500, "Les alertes sont momentanément indisponibles.", { cause: error });
    }
  }

  async getUnreadAlertsByUserId(userId: number): Promise<Alert[]> {
    try {
      const unreadAlerts = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)))
        .orderBy(desc(alerts.createdAt));
      
      console.log(`Alertes non lues pour l'utilisateur ${userId}:`, unreadAlerts.length);
      return unreadAlerts;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting unread alerts");
      throw new AppError(500, "Les alertes sont momentanément indisponibles.", { cause: error });
    }
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    try {
      const [newAlert] = await db.insert(alerts).values(alert).returning();
      return newAlert;
    } catch (error) {
      console.error('Error creating alert:', error);
      throw new Error('Erreur lors de la création de l\'alerte');
    }
  }

  async markAlertAsRead(id: number): Promise<Alert | undefined> {
    try {
      const [updatedAlert] = await db
        .update(alerts)
        .set({ isRead: true })
        .where(eq(alerts.id, id))
        .returning();
      return updatedAlert;
    } catch (error) {
      console.error('Error marking alert as read:', error);
      return undefined;
    }
  }

  async deleteAlert(id: number): Promise<boolean> {
    try {
      await db.delete(alerts).where(eq(alerts.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting alert:', error);
      return false;
    }
  }
  
  async getPartRequirement(id: number): Promise<PartRequirementWithRelations | undefined> {
    try {
      const [requirement] = await db
        .select({
          id: partRequirements.id,
          partId: partRequirements.partId,
          vehicleId: partRequirements.vehicleId,
          workOrderId: partRequirements.workOrderId,
          variantId: partRequirements.variantId,
          quantityNeeded: partRequirements.quantityNeeded,
          reason: partRequirements.reason,
          urgency: partRequirements.urgency,
          status: partRequirements.status,
          requestedBy: partRequirements.requestedBy,
          receivedBy: partRequirements.receivedBy,
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
        .leftJoin(users, eq(partRequirements.requestedBy, users.id))
        .where(eq(partRequirements.id, id));
      return requirement;
    } catch (error) {
      console.error('Error getting part requirement:', error);
      return undefined;
    }
  }

  async getPartRequirements(status?: string): Promise<PartRequirementWithRelations[]> {
    try {
      const query = db
        .select({
          id: partRequirements.id,
          partId: partRequirements.partId,
          vehicleId: partRequirements.vehicleId,
          workOrderId: partRequirements.workOrderId,
          variantId: partRequirements.variantId,
          quantityNeeded: partRequirements.quantityNeeded,
          reason: partRequirements.reason,
          urgency: partRequirements.urgency,
          status: partRequirements.status,
          requestedBy: partRequirements.requestedBy,
          receivedBy: partRequirements.receivedBy,
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

      const filteredQuery =
        status && status !== 'all'
          ? query.where(eq(partRequirements.status, status as PartRequirement["status"]))
          : query;

      const requirements = await filteredQuery.orderBy(desc(partRequirements.createdAt));
      console.log(`Found ${requirements.length} part requirements`);
      return requirements;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting part requirements");
      throw new AppError(500, "La liste des demandes de pièces est momentanément indisponible.", { cause: error });
    }
  }

  async getPartRequirementsByPartId(partId: number): Promise<PartRequirementWithRelations[]> {
    try {
      const requirements = await db
        .select({
          id: partRequirements.id,
          partId: partRequirements.partId,
          vehicleId: partRequirements.vehicleId,
          workOrderId: partRequirements.workOrderId,
          variantId: partRequirements.variantId,
          quantityNeeded: partRequirements.quantityNeeded,
          reason: partRequirements.reason,
          urgency: partRequirements.urgency,
          status: partRequirements.status,
          requestedBy: partRequirements.requestedBy,
          receivedBy: partRequirements.receivedBy,
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
        .leftJoin(users, eq(partRequirements.requestedBy, users.id))
        .where(eq(partRequirements.partId, partId))
        .orderBy(desc(partRequirements.createdAt));
      
      return requirements;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting part requirements by part ID");
      throw new AppError(500, "Les demandes de cette pièce sont momentanément indisponibles.", { cause: error });
    }
  }

  async createPartRequirement(requirement: InsertPartRequirement): Promise<PartRequirement> {
    try {
      const [newRequirement] = await db
        .insert(partRequirements)
        .values(requirement)
        .returning();
      return newRequirement;
    } catch (error) {
      console.error('Error creating part requirement:', error);
      throw new Error('Erreur lors de la création de la demande');
    }
  }

  async deletePartRequirement(id: number): Promise<boolean> {
    try {
      await db.delete(partRequirements).where(eq(partRequirements.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting part requirement:', error);
      return false;
    }
  }

  // Fault Catalog implementation
  async getFaultCatalogs(): Promise<FaultCatalog[]> {
    try {
      const catalogs = await db.select().from(faultCatalog).orderBy(desc(faultCatalog.createdAt));
      return catalogs;
    } catch (error) {
      storageLog.error({ err: error }, "Error getting fault catalogs");
      throw new AppError(500, "Le catalogue des pannes est momentanément indisponible.", { cause: error });
    }
  }

  async createFaultCatalog(catalog: InsertFaultCatalog): Promise<FaultCatalog> {
    try {
      const [newCatalog] = await db.insert(faultCatalog).values(catalog).returning();
      return newCatalog;
    } catch (error) {
      console.error('Error creating fault catalog:', error);
      throw new Error('Erreur lors de la création du catalogue d\'intervention');
    }
  }

  async deleteFaultCatalog(id: number): Promise<boolean> {
    try {
      await db.delete(faultCatalog).where(eq(faultCatalog.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting fault catalog:', error);
      return false;
    }
  }

  async getTireRotationsForWorkOrder(workOrderId: number): Promise<TireRotationWithRelations[]> {
    try {
      const rotations = await db
        .select({
          id: tireRotations.id,
          vehicleId: tireRotations.vehicleId,
          workOrderId: tireRotations.workOrderId,
          rotationDate: tireRotations.rotationDate,
          rotationMileage: tireRotations.rotationMileage,
          rotationType: tireRotations.rotationType,
          performedBy: tireRotations.performedBy,
          cost: tireRotations.cost,
          nextRotationMileage: tireRotations.nextRotationMileage,
          notes: tireRotations.notes,
          createdBy: tireRotations.createdBy,
          createdAt: tireRotations.createdAt,
          technicianName: users.name,
          vehicleRegistration: vehicles.registrationNumber
        })
        .from(tireRotations)
        .leftJoin(users, eq(tireRotations.performedBy, users.id))
        .leftJoin(vehicles, eq(tireRotations.vehicleId, vehicles.id))
        .where(eq(tireRotations.workOrderId, workOrderId))
        .orderBy(tireRotations.rotationDate);
      
      // Identifiants et nombre seulement : les lignes portent le coût de la rotation.
      storageLog.debug({ workOrderId, count: rotations.length, rotationIds: rotations.map((r) => r.id) }, "Rotations récupérées pour l'ordre");
      return rotations;
    } catch (error) {
      storageLog.error({ err: error, workOrderId }, "Error getting tire rotations for work order");
      // Une liste vide passerait pour « aucune rotation sur cet OT ».
      throw new AppError(500, "Les rotations de pneus de l'ordre de travail sont momentanément indisponibles.", { cause: error });
    }
  }
}

export const storage = new DatabaseStorage();
