import { db } from '../db';
import { workOrders, vehicles, users, partsUsed, parts, tireRotations, workOrderItems } from '../../shared/schema';
import { eq, and, desc, inArray, sum, sql } from 'drizzle-orm';
import { computeWorkOrderCost } from '@shared/work-order-cost';
import { moduleLogger } from '../lib/logger';
import { laborRatesForWorkOrders } from './workshop-labor-rates-service';
import { workOrderStaffScope } from "../lib/work-order-realtime-scope";

const log = moduleLogger('technician-work-orders');

export interface TechnicianWorkOrder {
  id: number;
  vehicleId: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  duration: number | null;
  cost: number | null;
  technicianId: number | null;
  createdAt: Date;
  updatedAt: Date | null;
  vehicleRegistrationNumber?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleMileage?: number;
  assignedTechnicianName?: string;
  priorityLabel?: string;
  statusLabel?: string;
  isOverdue?: boolean;
  estimatedDuration?: number;
  baseCost?: number;
  partsCost?: number;
  tiresCost?: number;
}

export interface WorkOrderStats {
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;
  total: number;
}

interface WorkOrderCostBreakdown {
  baseCost: number;
  partsCost: number;
  tiresCost: number;
  totalCost: number;
}

const ZERO_COST: WorkOrderCostBreakdown = { baseCost: 0, partsCost: 0, tiresCost: 0, totalCost: 0 };

export class TechnicianWorkOrdersService {
  /**
   * Récupérer tous les ordres de travail assignés à un technicien spécifique
   */
  async getTechnicianWorkOrders(technicianId: number): Promise<TechnicianWorkOrder[]> {
    try {
      log.debug({ technicianId }, 'récupération des ordres de travail du technicien');

      const result = await db
        .select({
          id: workOrders.id,
          vehicleId: workOrders.vehicleId,
          title: workOrders.title,
          description: workOrders.description,
          priority: workOrders.priority,
          status: workOrders.status,
          startDate: workOrders.startDate,
          endDate: workOrders.endDate,
          duration: workOrders.duration,
          cost: workOrders.cost,
          technicianId: workOrders.technicianId,
          createdAt: workOrders.createdAt,
          updatedAt: workOrders.updatedAt,
          // Informations véhicule
          vehicleRegistrationNumber: vehicles.registrationNumber,
          vehicleBrand: vehicles.brand,
          vehicleModel: vehicles.model,
          vehicleMileage: vehicles.mileage,
          vehicleCurrentKilometers: vehicles.currentKilometers,
          // Informations technicien
          assignedTechnicianName: users.name
        })
        .from(workOrders)
        .leftJoin(vehicles, eq(workOrders.vehicleId, vehicles.id))
        .leftJoin(users, eq(workOrders.technicianId, users.id))
        .where(eq(workOrders.technicianId, technicianId))
        .orderBy(desc(workOrders.createdAt));

      // Coûts de toute la liste en quatre requêtes groupées, pas cinq par OT.
      const costs = await this.calculateWorkOrderCosts(result.map((wo) => ({ id: wo.id, cost: wo.cost })));
      const enrichedWorkOrders: TechnicianWorkOrder[] = result.map((wo) => {
          const costBreakdown = costs.get(wo.id) ?? ZERO_COST;
          return {
            id: wo.id,
            vehicleId: wo.vehicleId,
            title: wo.title,
            description: wo.description,
            priority: wo.priority,
            status: wo.status,
            startDate: wo.startDate,
            endDate: wo.endDate,
            duration: wo.duration,
            cost: costBreakdown.totalCost,
            baseCost: costBreakdown.baseCost,
            partsCost: costBreakdown.partsCost,
            tiresCost: costBreakdown.tiresCost,
            technicianId: wo.technicianId,
            createdAt: wo.createdAt,
            updatedAt: wo.updatedAt,
            vehicleRegistrationNumber: wo.vehicleRegistrationNumber || undefined,
            vehicleBrand: wo.vehicleBrand || undefined,
            vehicleModel: wo.vehicleModel || undefined,
            vehicleMileage: Number(wo.vehicleCurrentKilometers ?? wo.vehicleMileage ?? 0),
            assignedTechnicianName: wo.assignedTechnicianName || undefined,
            priorityLabel: this.getPriorityLabel(wo.priority),
            statusLabel: this.getStatusLabel(wo.status),
            isOverdue: this.isWorkOrderOverdue(wo.startDate, wo.status),
            estimatedDuration: this.getDefaultDuration(wo.title)
          };
        });

      log.debug({ technicianId, count: enrichedWorkOrders.length }, 'ordres de travail du technicien trouvés');
      return enrichedWorkOrders;
    } catch (error) {
      log.error({ err: error, technicianId }, 'récupération des ordres de travail du technicien impossible');
      throw error;
    }
  }

  /**
   * Détail des coûts d'une liste d'OT : même règle que l'écran, le PDF et le KPI
   * (`shared/work-order-cost.ts`). La main-d'oeuvre vaut heures réelles × taux en vigueur
   * quand un taux existe, sinon `work_orders.cost`. Quatre requêtes groupées, quelle que
   * soit la longueur de la liste. Si l'une des requêtes échoue, l'erreur est journalisée et la
   * carte renvoyée est vide : l'appelant lit alors `ZERO_COST` pour tous les OT de la liste, y
   * compris ceux dont le coût de base est renseigné. Avant le calcul groupé, la panne ne
   * touchait que l'OT en cause.
   */
  private async calculateWorkOrderCosts(
    rows: ReadonlyArray<{ id: number; cost: string | number | null }>,
  ): Promise<Map<number, WorkOrderCostBreakdown>> {
    const costs = new Map<number, WorkOrderCostBreakdown>();
    if (rows.length === 0) return costs;
    const ids = rows.map((row) => row.id);
    try {
      const [hoursRows, partsRows, rotationsRows, rates] = await Promise.all([
        db
          .select({
            workOrderId: workOrderItems.workOrderId,
            hours: sql<string>`COALESCE(SUM(${workOrderItems.actualHours}), 0)`,
          })
          .from(workOrderItems)
          .where(and(inArray(workOrderItems.workOrderId, ids), sql`${workOrderItems.status} <> 'cancelled'`))
          .groupBy(workOrderItems.workOrderId),
        db
          .select({
            workOrderId: partsUsed.workOrderId,
            total: sql<string>`COALESCE(SUM(${partsUsed.unitPrice} * ${partsUsed.quantity}), 0)`,
          })
          .from(partsUsed)
          .where(inArray(partsUsed.workOrderId, ids))
          .groupBy(partsUsed.workOrderId),
        db
          .select({
            workOrderId: tireRotations.workOrderId,
            total: sql<string>`COALESCE(SUM(CAST(${tireRotations.cost} AS NUMERIC)), 0)`,
          })
          .from(tireRotations)
          .where(inArray(tireRotations.workOrderId, ids))
          .groupBy(tireRotations.workOrderId),
        laborRatesForWorkOrders(ids),
      ]);
      const hoursOf = new Map(hoursRows.map((row) => [Number(row.workOrderId), row.hours]));
      const partsOf = new Map(partsRows.map((row) => [Number(row.workOrderId), Number(row.total) || 0]));
      const rotationsOf = new Map(rotationsRows.map((row) => [Number(row.workOrderId), Number(row.total) || 0]));

      for (const row of rows) {
        const partsCost = partsOf.get(row.id) ?? 0;
        const tiresCost = rotationsOf.get(row.id) ?? 0;
        const { baseCost, totalCost } = computeWorkOrderCost({
          baseCost: row.cost,
          parts: [{ unitPrice: partsCost, quantity: 1 }],
          tireRotations: [{ cost: tiresCost }],
          laborHours: hoursOf.get(row.id) ?? 0,
          laborRate: rates.get(row.id) ?? null,
        });
        costs.set(row.id, { baseCost, partsCost, tiresCost, totalCost });
      }
      log.debug({ count: rows.length }, "coûts des OT calculés");
    } catch (error) {
      log.error({ err: error, workOrderIds: ids }, "calcul du coût des OT impossible");
    }
    return costs;
  }

  /**
   * Récupérer les statistiques des ordres de travail pour un technicien
   */
  async getTechnicianWorkOrderStats(technicianId: number): Promise<WorkOrderStats> {
    try {
      const workOrdersList = await this.getTechnicianWorkOrders(technicianId);
      
      const stats: WorkOrderStats = {
        pending: workOrdersList.filter(wo => wo.status === 'pending').length,
        inProgress: workOrdersList.filter(wo => wo.status === 'in_progress').length,
        completed: workOrdersList.filter(wo => wo.status === 'completed').length,
        overdue: workOrdersList.filter(wo => wo.isOverdue).length,
        total: workOrdersList.length
      };

      console.log(`📊 [TECH-WO] Stats pour technicien ${technicianId}:`, stats);
      return stats;
    } catch (error) {
      console.error('Erreur lors du calcul des statistiques:', error);
      throw error;
    }
  }

  /**
   * Mettre à jour le statut d'un ordre de travail
   */
  async updateWorkOrderStatus(
    workOrderId: number, 
    technicianId: number, 
    newStatus: string, 
    notes?: string
  ): Promise<TechnicianWorkOrder | null> {
    try {
      console.log(`🔄 [TECH-WO] Mise à jour statut OT ${workOrderId} vers ${newStatus} par technicien ${technicianId}`);
      
      // Vérifier que l'ordre appartient au technicien
      const existingOrder = await db
        .select()
        .from(workOrders)
        .where(and(
          eq(workOrders.id, workOrderId),
          eq(workOrders.technicianId, technicianId)
        ))
        .limit(1);

      if (!existingOrder.length) {
        throw new Error('Ordre de travail non trouvé ou non assigné à ce technicien');
      }

      const updateData: any = {
        status: newStatus,
        updatedAt: new Date()
      };

      if (notes) {
        updateData.notes = notes;
      }

      if (newStatus === 'completed') {
        updateData.completedDate = new Date();
      }

      const [updatedOrder] = await db
        .update(workOrders)
        .set(updateData)
        .where(eq(workOrders.id, workOrderId))
        .returning();

      if (newStatus === 'completed' && existingOrder[0].status !== 'completed') {
        // P3-1 : un OT préventif clôturé fait avancer l'échéance de son plan.
        const { preventiveMaintenanceService } = await import('./preventive-maintenance-service');
        await preventiveMaintenanceService.onWorkOrderCompleted(workOrderId);
      }

      console.log(`✅ [TECH-WO] Statut mis à jour avec succès`);
      
      // Diffuser la mise à jour via WebSocket temps réel
      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('work_order_status_changed', {
          scope: workOrderStaffScope(),
          workOrderId,
          technicianId,
          oldStatus: existingOrder[0].status,
          newStatus,
          notes
        });
      }
      
      // Retourner l'ordre enrichi
      const enrichedOrders = await this.getTechnicianWorkOrders(technicianId);
      return enrichedOrders.find(wo => wo.id === workOrderId) || null;
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
      throw error;
    }
  }

  /**
   * Récupérer les ordres en attente (pour notifications)
   */
  async getPendingWorkOrdersCount(technicianId: number): Promise<number> {
    try {
      const result = await db
        .select({ count: workOrders.id })
        .from(workOrders)
        .where(and(
          eq(workOrders.technicianId, technicianId),
          eq(workOrders.status, 'pending')
        ));

      return result.length;
    } catch (error) {
      console.error('Erreur lors du comptage des ordres en attente:', error);
      return 0;
    }
  }

  /**
   * Prendre en charge un ordre de travail (passer de pending à in_progress)
   */
  async takeWorkOrder(workOrderId: number, technicianId: number): Promise<TechnicianWorkOrder | null> {
    return this.updateWorkOrderStatus(
      workOrderId, 
      technicianId, 
      'in_progress', 
      'Ordre de travail pris en charge par le technicien'
    );
  }

  /**
   * Terminer un ordre de travail
   */
  async completeWorkOrder(
    workOrderId: number, 
    technicianId: number, 
    completionNotes?: string
  ): Promise<TechnicianWorkOrder | null> {
    return this.updateWorkOrderStatus(
      workOrderId, 
      technicianId, 
      'completed', 
      completionNotes || 'Ordre de travail terminé'
    );
  }

  // Méthodes utilitaires privées
  private getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      'critical': 'Critique',
      'high': 'Haute',
      'medium': 'Moyenne', 
      'low': 'Faible'
    };
    return labels[priority] || priority;
  }

  private getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      'pending': 'En attente',
      'in_progress': 'En cours',
      'completed': 'Terminé',
      'cancelled': 'Annulé'
    };
    return labels[status] || status;
  }

  private isWorkOrderOverdue(scheduledDate: Date | null, status: string): boolean {
    if (!scheduledDate || status === 'completed') return false;
    return new Date(scheduledDate) < new Date();
  }

  private getDefaultDuration(title: string): number {
    // Durée estimée par défaut selon le type de tâche
    const durations: Record<string, number> = {
      'vidange': 2,
      'révision': 4,
      'contrôle': 1,
      'changement': 3,
      'réparation': 3,
      'maintenance': 2
    };

    for (const [keyword, duration] of Object.entries(durations)) {
      if (title.toLowerCase().includes(keyword)) {
        return duration;
      }
    }
    return 2; // Durée par défaut
  }
}

// Instance singleton
export const technicianWorkOrdersService = new TechnicianWorkOrdersService();
