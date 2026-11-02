import { db } from "../db";
import { maintenanceSchedules, workOrders, vehicles, type MaintenanceSchedule, type WorkOrder } from "@shared/schema";
import { eq, and, gte, lte, desc, asc } from "drizzle-orm";
import { vehicleStatusService } from "./vehicle-status-service";
import { describeStatusChange } from "@shared/constants/vehicle-status";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("preventive-maintenance");
const OPEN_WORK_ORDER_STATUSES = ["pending", "in_progress", "awaiting_parts"] as const;

function broadcastWorkOrderCreated(workOrder: WorkOrder, source: string): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate("work_order_created", {
    workOrderId: workOrder.id,
    workOrder,
    source,
  });
}

export interface MaintenanceScheduleData {
  vehicleId: number;
  title: string;
  description?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'mileage';
  frequencyValue: number;
  scheduledDate: string;
  scheduledMileage?: number;
  isActive: boolean;
}

export interface ScheduledMaintenanceJob {
  scheduleId: number;
  vehicleId: string;
  dueDate: string;
  maintenanceType: string;
  description: string;
  estimatedDuration?: number;
  priority: 'low' | 'medium' | 'high';
}

export class PreventiveMaintenanceService {
  /**
   * Créer une nouvelle planification de maintenance préventive
   */
  async createMaintenanceSchedule(data: MaintenanceScheduleData): Promise<MaintenanceSchedule> {
    try {
      const [schedule] = await db
        .insert(maintenanceSchedules)
        .values({
          vehicleId: data.vehicleId,
          title: data.title,
          description: data.description,
          frequency: data.frequency,
          frequencyValue: data.frequencyValue,
          scheduledDate: data.scheduledDate,
          scheduledMileage: data.scheduledMileage,
          isActive: data.isActive
        })
        .returning();

      // Générer automatiquement un ordre de travail préventif si la planification est active
      if (schedule.isActive) {
        try {
          await this.generateWorkOrderFromSchedule(schedule);
          console.log(`✅ Ordre de travail automatique créé pour la planification #${schedule.id}`);
        } catch (workOrderError) {
          console.error('Erreur lors de la création automatique de l\'ordre de travail:', workOrderError);
          // Ne pas faire échouer la création de la planification si l'OT échoue
        }
      }

      return schedule;
    } catch (error) {
      console.error('Error creating maintenance schedule:', error);
      throw new Error('Erreur lors de la création de la planification de maintenance');
    }
  }

  /**
   * Calculer la prochaine date d'échéance
   */
  private calculateNextDueDate(startDate: string | Date, frequencyType: string, frequencyValue: number): Date {
    const baseDate = startDate instanceof Date ? startDate : new Date(startDate);
    const nextDate = new Date(baseDate);
    
    switch (frequencyType) {
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + frequencyValue);
        break;
      case 'quarterly':
        nextDate.setMonth(nextDate.getMonth() + (frequencyValue * 3));
        break;
      case 'yearly':
        nextDate.setFullYear(nextDate.getFullYear() + frequencyValue);
        break;
      case 'mileage':
        // Pour le kilométrage, on estime une date basée sur l'usage moyen
        // (ex: 1000km/mois en moyenne)
        const estimatedMonths = Math.ceil(frequencyValue / 1000);
        nextDate.setMonth(nextDate.getMonth() + estimatedMonths);
        break;
      default:
        throw new Error(`Type de fréquence non supporté: ${frequencyType}`);
    }
    
    return nextDate;
  }

  /**
   * Vérifier et déclencher les maintenances basées sur la date
   */
  async checkDateBasedMaintenance(vehicleId?: number, alertType?: string, createdBy?: number): Promise<WorkOrder[]> {
    try {
      const today = new Date();
      const alertPeriod = 30; // Alerte 30 jours avant échéance
      const alertDate = new Date(today);
      alertDate.setDate(today.getDate() + alertPeriod);

      // Récupérer les véhicules à vérifier
      let vehiclesToCheck;
      if (vehicleId) {
        const [vehicle] = await db
          .select()
          .from(vehicles)
          .where(eq(vehicles.id, vehicleId));
        vehiclesToCheck = vehicle ? [vehicle] : [];
      } else {
        vehiclesToCheck = await db
          .select()
          .from(vehicles);
      }

      const generatedWorkOrders: WorkOrder[] = [];

      for (const vehicle of vehiclesToCheck) {
        // On garde l'OT declencheur, pas juste un booleen: l'historique de
        // statut doit pouvoir nommer la cause de l'immobilisation.
        let declencheur: WorkOrder | null = null;

        // Vérifier nextMaintenanceDate (seulement si alertType absent ou === 'maintenance')
        if (!alertType || alertType === 'maintenance') {
          if (vehicle.nextMaintenanceDate) {
            const maintenanceDate = new Date(vehicle.nextMaintenanceDate);
            if (maintenanceDate <= alertDate) {
              const workOrder = await this.createDateBasedWorkOrder(
                vehicle,
                'Maintenance préventive programmée',
                `Maintenance programmée pour le véhicule ${vehicle.registrationNumber}. Date d'échéance: ${maintenanceDate.toLocaleDateString()}`,
                'maintenance',
                createdBy
              );
              if (workOrder) { generatedWorkOrders.push(workOrder); declencheur = declencheur ?? workOrder; }
            }
          }
        }

        // Vérifier assurance
        if (!alertType || alertType === 'insurance') {
          if (vehicle.insuranceExpiry) {
            const insuranceDate = new Date(vehicle.insuranceExpiry);
            if (insuranceDate <= alertDate) {
              const workOrder = await this.createDateBasedWorkOrder(
                vehicle,
                'Renouvellement assurance',
                `Assurance du véhicule ${vehicle.registrationNumber} expire le ${insuranceDate.toLocaleDateString()}. Renouvellement requis.`,
                'insurance',
                createdBy
              );
              if (workOrder) generatedWorkOrders.push(workOrder);
            }
          }
        }

        // Vérifier contrôle technique
        if (!alertType || alertType === 'inspection') {
          if (vehicle.technicalInspectionDate) {
            const inspectionDate = new Date(vehicle.technicalInspectionDate);
            if (inspectionDate <= alertDate) {
              const workOrder = await this.createDateBasedWorkOrder(
                vehicle,
                'Contrôle technique',
                `Contrôle technique du véhicule ${vehicle.registrationNumber} expire le ${inspectionDate.toLocaleDateString()}. Inspection requise.`,
                'inspection',
                createdBy
              );
              if (workOrder) generatedWorkOrders.push(workOrder);
            }
          }
        }

        // Vérifier plaque d'immatriculation
        if (!alertType || alertType === 'license') {
          if (vehicle.licensePlateExpiry) {
            const licensePlateDate = new Date(vehicle.licensePlateExpiry);
            if (licensePlateDate <= alertDate) {
              const workOrder = await this.createDateBasedWorkOrder(
                vehicle,
                'Renouvellement plaque d\'immatriculation',
                `Plaque d'immatriculation du véhicule ${vehicle.registrationNumber} expire le ${licensePlateDate.toLocaleDateString()}. Renouvellement requis.`,
                'license',
                createdBy
              );
              if (workOrder) generatedWorkOrders.push(workOrder);
            }
          }
        }

        // Échéance d'un plan actif (hors kilométrage) dans la fenêtre d'alerte,
        // ou dépassée : un OT lié au plan, jamais deux pour la même échéance.
        const plansEchus = await db
          .select()
          .from(maintenanceSchedules)
          .where(and(
            eq(maintenanceSchedules.vehicleId, vehicle.id),
            eq(maintenanceSchedules.isActive, true),
            lte(maintenanceSchedules.scheduledDate, alertDate.toISOString().slice(0, 10)),
          ));
        for (const plan of plansEchus) {
          if (plan.frequency === 'mileage' || !plan.scheduledDate) continue;
          try {
            // Un OT ouvert bloque (en attente, démarré, en attente de pièces). Un OT
            // clôturé bloque aussi tant que l'échéance du plan n'a pas avancé : il
            // porte l'échéance qu'il a traitée dans `startDate`.
            const echeance = new Date(plan.scheduledDate);
            const dejaTraite = (await db
              .select({ id: workOrders.id, status: workOrders.status, startDate: workOrders.startDate })
              .from(workOrders)
              .where(eq(workOrders.maintenanceScheduleId, plan.id)))
              .some((ot) =>
                (OPEN_WORK_ORDER_STATUSES as readonly string[]).includes(ot.status) ||
                (ot.status !== 'cancelled' && ot.startDate != null && new Date(ot.startDate) >= echeance));
            if (dejaTraite) continue;
            generatedWorkOrders.push(await this.generateWorkOrderFromSchedule(plan));
          } catch (error) {
            // Un plan en échec ne doit pas empêcher les autres.
            log.error({ err: error, scheduleId: plan.id, vehicleId: vehicle.id }, "Plan préventif : OT non généré");
          }
        }

        // Immobilisation du véhicule: passer par `vehicleStatusService`, jamais
        // par un `db.update` direct. Le service historise le changement dans
        // `status_history` avec sa cause; l'écriture directe ne laissait qu'une
        // ligne de log serveur, donc un véhicule en maintenance sans trace
        // consultable ni OT visible à l'écran.
        if (declencheur && vehicle.status === 'operational') {
          await vehicleStatusService.setVehicleToMaintenance(
            vehicle.id,
            declencheur.id,
            createdBy,
            `${describeStatusChange("preventive", "maintenance", vehicle.status)} — OT #${declencheur.id} généré automatiquement`,
          );
        }
      }

      return generatedWorkOrders;
    } catch (error) {
      console.error('Erreur lors de la vérification des maintenances basées sur la date:', error);
      return [];
    }
  }

  /**
   * Créer un ordre de travail basé sur une échéance de date
   */
  private async createDateBasedWorkOrder(
    vehicle: any,
    title: string,
    description: string,
    type: 'maintenance' | 'insurance' | 'inspection' | 'license',
    createdBy?: number
  ): Promise<WorkOrder | null> {
    try {
      // Vérifier s'il n'y a pas déjà un ordre de travail similaire en cours
      const existingWorkOrder = await db
        .select()
        .from(workOrders)
        .where(and(
          eq(workOrders.vehicleId, vehicle.id),
          eq(workOrders.title, title),
          eq(workOrders.status, 'pending')
        ))
        .limit(1);

      if (existingWorkOrder.length > 0) {
        console.log(`Ordre de travail déjà existant pour ${title} du véhicule ${vehicle.registrationNumber}`);
        return null;
      }

      // Définir la priorité selon le type et l'urgence
      const today = new Date();
      let priority: 'low' | 'medium' | 'high' = 'medium';
      
      if (type === 'insurance' || type === 'inspection' || type === 'license') {
        priority = 'high'; // Documents légaux = priorité haute
      }

      const [workOrder] = await db
        .insert(workOrders)
        .values({
          vehicleId: vehicle.id,
          vehicleRegistration: vehicle.registrationNumber ?? null,
          vehicleBrand: vehicle.brand ?? null,
          vehicleModel: vehicle.model ?? null,
          title,
          description: `${description}\n\nOrdre de travail automatique généré par le système de maintenance préventive`,
          status: 'pending' as const,
          priority,
          startDate: today,
          isPreventive: true,
          cost: "0",
          createdBy: createdBy ?? null
        })
        .returning();

      console.log(`✅ Ordre de travail basé sur la date créé: ${workOrder.id} pour véhicule ${vehicle.registrationNumber} - ${title}`);
      broadcastWorkOrderCreated(workOrder, `date_based_${type}`);
      return workOrder;
    } catch (error) {
      console.error(`Erreur lors de la création de l'ordre de travail pour ${title}:`, error);
      return null;
    }
  }

  /**
   * Vérifier et déclencher les maintenances basées sur le kilométrage
   */
  async checkMileageBasedMaintenance(vehicleId: number, currentMileage: number): Promise<WorkOrder[]> {
    try {
      // Récupérer toutes les planifications actives basées sur le kilométrage pour ce véhicule
      const mileageSchedules = await db
        .select()
        .from(maintenanceSchedules)
        .where(and(
          eq(maintenanceSchedules.vehicleId, vehicleId),
          eq(maintenanceSchedules.isActive, true),
          eq(maintenanceSchedules.frequency, 'mileage')
        ));

      const generatedWorkOrders: WorkOrder[] = [];

      for (const schedule of mileageSchedules) {
        if (schedule.scheduledMileage && currentMileage >= schedule.scheduledMileage) {
          // Vérifier s'il n'y a pas déjà un ordre de travail en cours pour cette planification
          const existingWorkOrder = await db
            .select()
            .from(workOrders)
            .where(and(
              eq(workOrders.vehicleId, vehicleId),
              // Le titre de l'OT généré n'est pas celui du plan : le lien fiable est maintenanceScheduleId.
              eq(workOrders.maintenanceScheduleId, schedule.id),
              eq(workOrders.status, 'pending')
            ))
            .limit(1);

          if (existingWorkOrder.length === 0) {
            console.log(`🔧 Déclenchement maintenance kilométrique pour véhicule ${vehicleId} à ${currentMileage}km (seuil: ${schedule.scheduledMileage}km)`);
            
            const workOrder = await this.generateWorkOrderFromSchedule(schedule);
            generatedWorkOrders.push(workOrder);

            // Calculer le prochain seuil kilométrique
            const nextMileage = schedule.scheduledMileage + schedule.frequencyValue;
            await db
              .update(maintenanceSchedules)
              .set({ scheduledMileage: nextMileage })
              .where(eq(maintenanceSchedules.id, schedule.id));

            console.log(`✅ Ordre de travail créé pour maintenance kilométrique. Prochain seuil: ${nextMileage}km`);
          }
        }
      }

      return generatedWorkOrders;
    } catch (error) {
      console.error('Erreur lors de la vérification des maintenances kilométriques:', error);
      return [];
    }
  }

  /**
   * Générer un ordre de travail à partir d'une planification
   */
  async generateWorkOrderFromSchedule(schedule: MaintenanceSchedule): Promise<WorkOrder> {
    try {
      // Récupérer les infos du véhicule
      const [vehicle] = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, schedule.vehicleId));

      if (!vehicle) {
        throw new Error(`Véhicule non trouvé: ${schedule.vehicleId}`);
      }

      const [workOrder] = await db
        .insert(workOrders)
        .values({
          vehicleId: schedule.vehicleId,
          title: `Maintenance préventive: ${schedule.title}`,
          description: `${schedule.description || ''}\n\nMaintenance automatique générée depuis la planification #${schedule.id}`,
          status: 'pending',
          priority: 'medium',
          technicianId: null, // À assigner manuellement
          startDate: schedule.scheduledDate ? new Date(schedule.scheduledDate) : new Date(),
          duration: Math.round(this.getEstimatedDuration(schedule.title) * 60),
          cost: "0",
          isPreventive: true,
          maintenanceScheduleId: schedule.id
        })
        .returning();

      console.log(`✅ Ordre de travail préventif créé: ${workOrder.id} pour véhicule ${vehicle.registrationNumber}`);
      broadcastWorkOrderCreated(workOrder, "preventive_schedule");
      
      return workOrder;
    } catch (error) {
      console.error('Error generating work order from schedule:', error);
      throw error;
    }
  }

  /**
   * Obtenir la durée estimée selon le type de maintenance
   */
  private getEstimatedDuration(maintenanceType: string): number {
    const durations: Record<string, number> = {
      'vidange': 2, // 2 heures
      'revision': 4, // 4 heures
      'controle_technique': 1, // 1 heure
      'changement_pneus': 3, // 3 heures
      'freinage': 2, // 2 heures
      'climatisation': 1.5, // 1.5 heures
      'batterie': 1, // 1 heure
      'filtres': 1.5, // 1.5 heures
      'courroies': 2, // 2 heures
      'echappement': 2.5, // 2.5 heures
    };

    // Recherche par mot-clé dans le type de maintenance
    for (const [type, duration] of Object.entries(durations)) {
      if (maintenanceType.toLowerCase().includes(type)) {
        return duration;
      }
    }

    return 2; // Durée par défaut
  }

  /**
   * Récupérer toutes les planifications actives d'un véhicule
   */
  async getVehicleMaintenanceSchedules(vehicleId: number): Promise<MaintenanceSchedule[]> {
    try {
      const schedules = await db
        .select()
        .from(maintenanceSchedules)
        .where(and(
          eq(maintenanceSchedules.vehicleId, vehicleId),
          eq(maintenanceSchedules.isActive, true)
        ))
        .orderBy(asc(maintenanceSchedules.scheduledDate));

      return schedules;
    } catch (error) {
      console.error('Error getting vehicle maintenance schedules:', error);
      return [];
    }
  }

  /**
   * Récupérer les prochaines maintenances dues
   */
  async getUpcomingMaintenances(daysAhead: number = 30): Promise<ScheduledMaintenanceJob[]> {
    try {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + daysAhead);
      const endDateString = endDate.toISOString().split('T')[0];

      const upcomingSchedules = await db
        .select({
          schedule: maintenanceSchedules,
          vehicle: vehicles
        })
        .from(maintenanceSchedules)
        .innerJoin(vehicles, eq(maintenanceSchedules.vehicleId, vehicles.id))
        .where(and(
          eq(maintenanceSchedules.isActive, true),
          lte(maintenanceSchedules.scheduledDate, endDateString)
        ))
        .orderBy(asc(maintenanceSchedules.scheduledDate));

      return upcomingSchedules.map(({ schedule, vehicle }) => ({
        scheduleId: schedule.id,
        vehicleId: vehicle.registrationNumber,
        dueDate: schedule.scheduledDate || new Date().toISOString().split('T')[0],
        maintenanceType: schedule.title,
        description: schedule.description || '',
        estimatedDuration: this.getEstimatedDuration(schedule.title),
        priority: this.calculatePriority(schedule.scheduledDate)
      }));
    } catch (error) {
      console.error('Error getting upcoming maintenances:', error);
      return [];
    }
  }

  /**
   * Calculer la priorité selon la proximité de l'échéance
   */
  private calculatePriority(dueDate: string | Date | null | undefined): 'low' | 'medium' | 'high' {
    const parsedDueDate = dueDate instanceof Date
      ? dueDate
      : dueDate
      ? new Date(dueDate)
      : new Date();

    const now = new Date();
    const diffDays = Math.ceil((parsedDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 7) return 'high';
    if (diffDays <= 14) return 'medium';
    return 'low';
  }

  /**
   * Marquer une maintenance comme terminée et planifier la suivante
   */
  async completeMaintenanceAndScheduleNext(scheduleId: number): Promise<MaintenanceSchedule | null> {
    try {
      const [schedule] = await db
        .select()
        .from(maintenanceSchedules)
        .where(eq(maintenanceSchedules.id, scheduleId));

      if (!schedule) {
        throw new Error(`Planification non trouvée: ${scheduleId}`);
      }

      // Calculer la prochaine date d'échéance
      const nextDueDate = this.calculateNextDueDate(
        schedule.scheduledDate || new Date(), 
        schedule.frequency, 
        schedule.frequencyValue
      );
      const nextDueDateString = nextDueDate.toISOString().split('T')[0];

      // Mettre à jour la planification
      const [updatedSchedule] = await db
        .update(maintenanceSchedules)
        .set({
          scheduledDate: nextDueDateString
        })
        .where(eq(maintenanceSchedules.id, scheduleId))
        .returning();

      // Générer le prochain ordre de travail
      await this.generateWorkOrderFromSchedule(updatedSchedule);

      console.log(`✅ Maintenance terminée et prochaine planifiée pour le ${nextDueDate.toLocaleDateString('fr-FR')}`);
      
      return updatedSchedule;
    } catch (error) {
      console.error('Error completing maintenance and scheduling next:', error);
      return null;
    }
  }

  /**
   * Désactiver une planification
   */
  async deactivateSchedule(scheduleId: number): Promise<boolean> {
    try {
      const result = await db
        .update(maintenanceSchedules)
        .set({
          isActive: false
        })
        .where(eq(maintenanceSchedules.id, scheduleId));

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Error deactivating schedule:', error);
      return false;
    }
  }

  /**
   * Réactiver une planification
   */
  async reactivateSchedule(scheduleId: number, newStartDate?: Date): Promise<MaintenanceSchedule | null> {
    try {
      const [schedule] = await db
        .select()
        .from(maintenanceSchedules)
        .where(eq(maintenanceSchedules.id, scheduleId));

      if (!schedule) return null;

      const startDate = newStartDate || new Date();
      const nextDueDate = this.calculateNextDueDate(
        startDate,
        schedule.frequency,
        schedule.frequencyValue
      );
      const nextDueDateString = nextDueDate.toISOString().split('T')[0];

      const [updatedSchedule] = await db
        .update(maintenanceSchedules)
        .set({
          isActive: true,
          scheduledDate: nextDueDateString
        })
        .where(eq(maintenanceSchedules.id, scheduleId))
        .returning();

      return updatedSchedule;
    } catch (error) {
      console.error('Error reactivating schedule:', error);
      return null;
    }
  }

  /**
   * Obtenir les statistiques de maintenance préventive
   */
  async getMaintenanceStatistics() {
    try {
      const [
        totalActiveSchedules,
        upcomingMaintenances,
        overdueMaintenances
      ] = await Promise.all([
        // Planifications actives
        db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.isActive, true)),
        
        // Maintenances à venir (7 prochains jours)
        db.select()
          .from(maintenanceSchedules)
          .where(and(
            eq(maintenanceSchedules.isActive, true),
            lte(maintenanceSchedules.scheduledDate, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
          )),
        
        // Maintenances en retard
        db.select()
          .from(maintenanceSchedules)
          .where(and(
            eq(maintenanceSchedules.isActive, true),
            lte(maintenanceSchedules.scheduledDate, new Date().toISOString().split('T')[0])
          ))
      ]);

      return {
        totalActiveSchedules: totalActiveSchedules.length,
        upcomingMaintenances: upcomingMaintenances.length,
        overdueMaintenances: overdueMaintenances.length,
        completionRate: totalActiveSchedules.length > 0 
          ? Math.round(((totalActiveSchedules.length - overdueMaintenances.length) / totalActiveSchedules.length) * 100)
          : 100
      };
    } catch (error) {
      console.error('Error getting maintenance statistics:', error);
      return {
        totalActiveSchedules: 0,
        upcomingMaintenances: 0,
        overdueMaintenances: 0,
        completionRate: 0
      };
    }
  }
}

export const preventiveMaintenanceService = new PreventiveMaintenanceService();
