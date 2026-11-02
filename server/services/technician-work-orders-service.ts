import { db } from '../db';
import { workOrders, vehicles, users, partsUsed, parts, tireRotations, workOrderItems } from '../../shared/schema';
import { eq, and, desc, inArray, sum, sql } from 'drizzle-orm';
import { computeWorkOrderCost } from '@shared/work-order-cost';
import { moduleLogger } from '../lib/logger';
import { laborRateForWorkOrder } from './workshop-labor-rates-service';

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

export class TechnicianWorkOrdersService {
  /**
   * Récupérer tous les ordres de travail assignés à un technicien spécifique
   */
  async getTechnicianWorkOrders(technicianId: number): Promise<TechnicianWorkOrder[]> {
    try {
      console.log(`🔧 [TECH-WO] Récupération des ordres de travail pour technicien ID: ${technicianId}`);
      
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

      // Calculer les coûts totaux pour chaque ordre de travail
      const enrichedWorkOrders: TechnicianWorkOrder[] = await Promise.all(
        result.map(async (wo) => {
          console.log(`🔧 [TECH-WO] Calcul du coût total pour l'ordre ${wo.id}`);
          const costBreakdown = await this.calculateWorkOrderCosts(wo.id);
          console.log(
            `🔧 [TECH-WO] Coûts calculés pour l'ordre ${wo.id}: Base=${costBreakdown.baseCost}, Pièces=${costBreakdown.partsCost}, Pneus=${costBreakdown.tiresCost}, Total=${costBreakdown.totalCost}`,
          );
          
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
        })
      );

      console.log(`🔧 [TECH-WO] Trouvé ${enrichedWorkOrders.length} ordres pour le technicien`);
      return enrichedWorkOrders;
    } catch (error) {
      console.error('Erreur lors de la récupération des ordres de travail technicien:', error);
      throw error;
    }
  }

  /**
   * Détail des coûts d'un ordre de travail : même règle que l'écran, le PDF et le KPI
   * (`shared/work-order-cost.ts`). La main-d'oeuvre vaut heures réelles × taux en vigueur
   * quand un taux existe, sinon `work_orders.cost`.
   */
  private async calculateWorkOrderCosts(workOrderId: number): Promise<WorkOrderCostBreakdown> {
    try {
      const workOrder = await db
        .select({ cost: workOrders.cost })
        .from(workOrders)
        .where(eq(workOrders.id, workOrderId))
        .limit(1);

      const hoursResult = await db
        .select({ hours: sql<string>`COALESCE(SUM(${workOrderItems.actualHours}), 0)` })
        .from(workOrderItems)
        .where(and(eq(workOrderItems.workOrderId, workOrderId), sql`${workOrderItems.status} <> 'cancelled'`));
      const rate = await laborRateForWorkOrder(workOrderId);

      // Coût des pièces détachées
      const partsResult = await db
        .select({
          totalPartsCost: sql<number>`COALESCE(SUM(${partsUsed.unitPrice} * ${partsUsed.quantity}), 0)`
        })
        .from(partsUsed)
        .where(eq(partsUsed.workOrderId, workOrderId));

      const partsCost = Number(partsResult[0]?.totalPartsCost || 0);

      // Coût des rotations de pneus
      const rotationsResult = await db
        .select({
          totalRotationsCost: sql<number>`COALESCE(SUM(CAST(${tireRotations.cost} AS NUMERIC)), 0)`
        })
        .from(tireRotations)
        .where(eq(tireRotations.workOrderId, workOrderId));

      const rotationsCost = Number(rotationsResult[0]?.totalRotationsCost) || 0;

      const { baseCost, totalCost } = computeWorkOrderCost({
        baseCost: workOrder[0]?.cost,
        parts: [{ unitPrice: partsCost, quantity: 1 }],
        tireRotations: [{ cost: rotationsCost }],
        laborHours: hoursResult[0]?.hours,
        laborRate: rate?.hourlyRateHt ?? null,
      });

      log.debug({ workOrderId, baseCost, partsCost, tiresCost: rotationsCost, totalCost }, "coût de l'OT calculé");

      return {
        baseCost,
        partsCost,
        tiresCost: rotationsCost,
        totalCost,
      };
    } catch (error) {
      log.error({ err: error, workOrderId }, "calcul du coût de l'OT impossible");
      return {
        baseCost: 0,
        partsCost: 0,
        tiresCost: 0,
        totalCost: 0,
      };
    }
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

      console.log(`✅ [TECH-WO] Statut mis à jour avec succès`);
      
      // Diffuser la mise à jour via WebSocket temps réel
      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('work_order_status_changed', {
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
