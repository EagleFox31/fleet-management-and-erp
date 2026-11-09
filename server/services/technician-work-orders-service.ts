import { db } from '../db';
import { workOrders, vehicles, users, partsUsed, parts, tireRotations, workOrderItems } from '../../shared/schema';
import { eq, and, desc, inArray, sum, sql } from 'drizzle-orm';
import { computeWorkOrderCost } from '@shared/work-order-cost';
import { moduleLogger } from '../lib/logger';
import { AppError } from '../lib/app-error';
import { laborRatesForWorkOrders } from './workshop-labor-rates-service';

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
  /** `null` avec `costUnavailable` quand le calcul a échoué : jamais 0 par défaut. */
  baseCost?: number | null;
  partsCost?: number | null;
  tiresCost?: number | null;
  costUnavailable?: boolean;
}

export interface WorkOrderStats {
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;
  total: number;
}

interface WorkOrderCostBreakdown {
  baseCost: number | null;
  partsCost: number | null;
  tiresCost: number | null;
  totalCost: number | null;
}

/** Coût d'un OT que le calcul n'a pas pu établir : tout à null, jamais à 0. */
const UNAVAILABLE_COST: WorkOrderCostBreakdown = Object.freeze({
  baseCost: null,
  partsCost: null,
  tiresCost: null,
  totalCost: null,
});

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
      const unavailableIds: number[] = [];
      const enrichedWorkOrders: TechnicianWorkOrder[] = result.map((wo) => {
          // Un coût absent n'est pas un coût nul : l'OT reste servi, son coût vaut null
          // (« Indisponible » à l'écran), jamais 0.
          const costBreakdown = costs.get(wo.id) ?? UNAVAILABLE_COST;
          const costUnavailable = costBreakdown.totalCost === null;
          if (costUnavailable) unavailableIds.push(wo.id);
          return {
            costUnavailable,
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

      // Un seul log pour toute la liste : la cause est déjà journalisée par composante.
      if (unavailableIds.length > 0) {
        log.warn(
          { technicianId, count: unavailableIds.length, workOrderIds: unavailableIds },
          "coût indisponible pour des OT du technicien",
        );
      }

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
   * soit la longueur de la liste, chacune isolée : une requête en échec est journalisée et ne
   * met à `null` que la composante qu'elle porte (main-d'oeuvre, pièces ou pneus), et le total
   * avec elle. Jamais 0 par défaut, et la liste des OT reste servie.
   */
  private async calculateWorkOrderCosts(
    rows: ReadonlyArray<{ id: number; cost: string | number | null }>,
  ): Promise<Map<number, WorkOrderCostBreakdown>> {
    const costs = new Map<number, WorkOrderCostBreakdown>();
    if (rows.length === 0) return costs;
    const ids = rows.map((row) => row.id);
    const [hoursResult, partsResult, rotationsResult, ratesResult] = await Promise.allSettled([
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

    const settled = <T,>(result: PromiseSettledResult<T>, component: string): T | null => {
      if (result.status === "fulfilled") return result.value;
      log.error({ err: result.reason, workOrderIds: ids, component }, "calcul d'une composante du coût des OT impossible");
      return null;
    };
    const hoursRows = settled(hoursResult, "heures");
    const partsRows = settled(partsResult, "pièces");
    const rotationsRows = settled(rotationsResult, "pneus");
    const rates = settled(ratesResult, "taux");

    const hoursOf = hoursRows && new Map(hoursRows.map((row) => [Number(row.workOrderId), row.hours]));
    const partsOf = partsRows && new Map(partsRows.map((row) => [Number(row.workOrderId), Number(row.total) || 0]));
    const rotationsOf = rotationsRows && new Map(rotationsRows.map((row) => [Number(row.workOrderId), Number(row.total) || 0]));

    for (const row of rows) {
      const partsCost = partsOf ? partsOf.get(row.id) ?? 0 : null;
      const tiresCost = rotationsOf ? rotationsOf.get(row.id) ?? 0 : null;
      const laborRate = rates ? rates.get(row.id) ?? null : undefined;
      // Main-d'oeuvre inconnue : taux illisibles, ou taux connu mais heures illisibles.
      // Sans taux, elle vaut `work_orders.cost` et ne dépend pas des heures.
      const laborUnknown = laborRate === undefined || (laborRate !== null && !hoursOf);
      const computed = computeWorkOrderCost({
        baseCost: row.cost,
        parts: [{ unitPrice: partsCost ?? 0, quantity: 1 }],
        tireRotations: [{ cost: tiresCost ?? 0 }],
        laborHours: hoursOf?.get(row.id) ?? 0,
        laborRate: laborRate ?? null,
      });
      const baseCost = laborUnknown ? null : computed.baseCost;
      const totalCost = baseCost === null || partsCost === null || tiresCost === null ? null : computed.totalCost;
      costs.set(row.id, { baseCost, partsCost, tiresCost, totalCost });
    }
    log.debug({ count: rows.length }, "coûts des OT calculés");
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

      log.debug({ technicianId, stats }, 'statistiques des ordres de travail du technicien');
      return stats;
    } catch (error) {
      log.error({ err: error, technicianId }, 'calcul des statistiques des ordres de travail impossible');
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
      log.error({ err: error, technicianId }, 'comptage des ordres de travail en attente impossible');
      throw new AppError(500, "Le nombre d'ordres de travail en attente n'a pas pu être compté.", { cause: error });
    }
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
