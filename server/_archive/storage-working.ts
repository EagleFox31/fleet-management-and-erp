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
}