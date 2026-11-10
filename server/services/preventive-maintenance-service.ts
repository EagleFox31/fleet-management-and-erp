import { db } from "../db";
import { maintenanceSchedules, workOrderPlanning, workOrders, vehicles, type MaintenanceSchedule, type WorkOrder } from "@shared/schema";
import { eq, and, gte, lte, lt, ne, isNotNull, desc, asc, sql } from "drizzle-orm";
import { moduleLogger } from "../lib/logger";
import { preventiveDueDay } from "../lib/kpi-rules";
import { maintenancePriorityOf } from "../lib/maintenance-priority";
import { isDateBasedDueAlreadyHandled, stampPreventiveDue } from "../lib/preventive-due";
import { workOrderCostScope } from "../lib/work-order-realtime-scope";

const log = moduleLogger("preventive-maintenance");

/** Rattrapage P3-1 : un plan calendaire resté bloqué derrière un OT préventif déjà clos. */
export interface ScheduleCatchUp {
  scheduleId: number;
  workOrderId: number;
  registrationNumber: string;
  title: string;
  currentDate: string;
  targetDate: string;
}

const toDay = (d: string | Date): string => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Ajoute des mois en UTC (décision D4) en bornant au dernier jour du mois cible :
 * 31/01 + 1 mois = 28/02 (ou 29/02), et non 03/03 comme `setMonth`.
 */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(date);
  out.setUTCFullYear(y, m, Math.min(date.getUTCDate(), lastDay));
  return out;
}

const OPEN_WORK_ORDER_STATUSES = ["pending", "in_progress", "awaiting_parts"] as const;

function broadcastWorkOrderCreated(workOrder: WorkOrder, source: string): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate("work_order_created", {
    scope: workOrderCostScope(),
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
          log.info(`✅ Ordre de travail automatique créé pour la planification #${schedule.id}`);
        } catch (workOrderError) {
          log.error({ err: workOrderError }, 'Erreur lors de la création automatique de l\'ordre de travail');
          // Ne pas faire échouer la création de la planification si l'OT échoue
        }
      }

      return schedule;
    } catch (error) {
      log.error({ err: error }, 'Error creating maintenance schedule');
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
      case 'daily':
        nextDate.setUTCDate(nextDate.getUTCDate() + frequencyValue);
        break;
      case 'weekly':
        nextDate.setUTCDate(nextDate.getUTCDate() + frequencyValue * 7);
        break;
      case 'monthly':
        return addMonthsUtc(baseDate, frequencyValue);
      case 'quarterly':
        return addMonthsUtc(baseDate, frequencyValue * 3);
      case 'yearly':
        return addMonthsUtc(baseDate, frequencyValue * 12);
      case 'mileage':
        // Pour le kilométrage, on estime une date basée sur l'usage moyen
        // (ex: 1000km/mois en moyenne)
        const estimatedMonths = Math.ceil(frequencyValue / 1000);
        return addMonthsUtc(baseDate, estimatedMonths);
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
                createdBy,
                maintenanceDate
              );
              if (workOrder) generatedWorkOrders.push(workOrder);
            }
          }
        }

        // Papiers (assurance, contrôle technique, plaque / carte grise) : plus
        // d'OT atelier. Un papier n'est pas un travail d'atelier ; les alertes
        // passent par alert-service (30 jours avant, puis expiré) et le blocage
        // par l'éligibilité (shared/constants/vehicle-eligibility.ts).

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
      }

      return generatedWorkOrders;
    } catch (error) {
      log.error({ err: error }, 'Erreur lors de la vérification des maintenances basées sur la date');
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
    createdBy?: number,
    dueOn?: Date
  ): Promise<WorkOrder | null> {
    try {
      // Idempotence : ce contrôle tourne en tâche de fond. Un OT de même titre ouvert (en
      // attente, démarré, en attente de pièces) bloque ; un OT clos bloque tant que
      // l'échéance du véhicule n'a pas avancé au-delà de celle qu'il a traitée.
      const existingWorkOrders = await db
        // `work_orders` est déclarée deux fois (workOrders, workOrderPlanning) : une jointure sur soi-même
        // échoue, la colonne d'échéance se lit donc en SQL sur la même table.
        .select({ status: workOrders.status, dueDate: sql<string | null>`"work_orders"."due_date"` })
        .from(workOrders)
        .where(and(
          eq(workOrders.vehicleId, vehicle.id),
          eq(workOrders.title, title),
        ));

      if (isDateBasedDueAlreadyHandled(existingWorkOrders, preventiveDueDay(dueOn, new Date()))) {
        log.info(`Ordre de travail déjà existant pour ${title} du véhicule ${vehicle.registrationNumber}`);
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

      await this.stampDue(workOrder.id, preventiveDueDay(dueOn, today));
      log.info(`✅ Ordre de travail basé sur la date créé: ${workOrder.id} pour véhicule ${vehicle.registrationNumber} - ${title}`);
      broadcastWorkOrderCreated(workOrder, `date_based_${type}`);
      return workOrder;
    } catch (error) {
      log.error({ err: error }, `Erreur lors de la création de l'ordre de travail pour ${title}`);
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
            log.info(`🔧 Déclenchement maintenance kilométrique pour véhicule ${vehicleId} à ${currentMileage}km (seuil: ${schedule.scheduledMileage}km)`);
            
            const workOrder = await this.generateWorkOrderFromSchedule(schedule);
            generatedWorkOrders.push(workOrder);

            // Calculer le prochain seuil kilométrique
            const nextMileage = schedule.scheduledMileage + schedule.frequencyValue;
            await db
              .update(maintenanceSchedules)
              .set({ scheduledMileage: nextMileage })
              .where(eq(maintenanceSchedules.id, schedule.id));

            log.info(`✅ Ordre de travail créé pour maintenance kilométrique. Prochain seuil: ${nextMileage}km`);
          }
        }
      }

      return generatedWorkOrders;
    } catch (error) {
      log.error({ err: error }, 'Erreur lors de la vérification des maintenances kilométriques');
      return [];
    }
  }

  /**
   * Fige l'échéance de l'OT préventif (`due_date`, `due_mileage`) : le taux de préventif la lit,
   * replanifier `start_date` ne la déplace plus. Un échec n'annule pas l'OT : l'indicateur se
   * replie alors sur `start_date`.
   */
  private async stampDue(workOrderId: number, dueDate: string, dueMileage?: number | null): Promise<void> {
    try {
      await db.transaction((tx) => stampPreventiveDue(tx, workOrderId, { dueDate, dueMileage }));
    } catch (error) {
      log.error({ err: error, workOrderId, dueDate }, "échéance de l'OT préventif non enregistrée");
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

      await this.stampDue(
        workOrder.id,
        preventiveDueDay(schedule.scheduledDate),
        schedule.frequency === 'mileage' ? schedule.scheduledMileage : null,
      );
      log.info(`✅ Ordre de travail préventif créé: ${workOrder.id} pour véhicule ${vehicle.registrationNumber}`);
      broadcastWorkOrderCreated(workOrder, "preventive_schedule");
      
      return workOrder;
    } catch (error) {
      log.error({ err: error }, 'Error generating work order from schedule');
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
      log.error({ err: error }, 'Error getting vehicle maintenance schedules');
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
      log.error({ err: error }, 'Error getting upcoming maintenances');
      return [];
    }
  }

  /**
   * Calculer la priorité selon la proximité de l'échéance
   */
  private calculatePriority(dueDate: string | Date | null | undefined): 'low' | 'medium' | 'high' {
    return maintenancePriorityOf(dueDate);
  }

  /**
   * P3-1 : un OT préventif clôturé fait avancer l'échéance de son plan.
   * - Base = échéance traitée par l'OT (`due_date`, sinon `start_date`), pas la date de clôture :
   *   planning fixe, un OT clos en retard ne fait pas dériver le plan.
   * - N'avance que si la date du plan est antérieure à la nouvelle échéance : une seconde clôture
   *   du même OT (refus qualité puis reprise) ne la repousse pas deux fois.
   * - Plans kilométriques exclus : leur seuil avance déjà à la génération de l'OT.
   * - Aucun OT généré d'avance : le balayage le crée à l'approche de l'échéance.
   * Renvoie la nouvelle date, ou `null` si rien n'a changé.
   */
  async advanceScheduleAfterCompletion(workOrderId: number): Promise<string | null> {
    const step = await this.nextScheduleStep(workOrderId);
    if (!step) return null;
    const { plan, next } = step;
    const [updated] = await db
      .update(maintenanceSchedules)
      .set({ scheduledDate: next })
      .where(and(eq(maintenanceSchedules.id, plan.id), lt(maintenanceSchedules.scheduledDate, next)))
      .returning({ scheduledDate: maintenanceSchedules.scheduledDate });
    if (!updated) return null;
    log.info({ workOrderId, scheduleId: plan.id, from: plan.scheduledDate, to: next }, "Plan préventif : échéance avancée après clôture de l'OT");
    return next;
  }

  /** Plan calendaire d'un OT préventif, échéance traitée (`base`) et échéance suivante (`next`). */
  private async nextScheduleStep(
    workOrderId: number,
  ): Promise<{ plan: MaintenanceSchedule; base: string; next: string; datedWorkOrder: boolean } | null> {
    const [wo] = await db
      .select({
        isPreventive: workOrders.isPreventive,
        scheduleId: workOrders.maintenanceScheduleId,
        startDate: workOrders.startDate,
      })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    if (!wo?.isPreventive || !wo.scheduleId) return null;
    // `due_date` est porté par la table compagnon (même table SQL, voir lib/preventive-due.ts).
    const [planning] = await db
      .select({ dueDate: workOrderPlanning.dueDate })
      .from(workOrderPlanning)
      .where(eq(workOrderPlanning.id, workOrderId));

    const [plan] = await db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.id, wo.scheduleId));
    if (!plan || plan.frequency === 'mileage' || !plan.scheduledDate) return null;

    const base = planning?.dueDate ?? wo.startDate ?? plan.scheduledDate;
    const next = toDay(this.calculateNextDueDate(base, plan.frequency, plan.frequencyValue));
    return { plan, base: toDay(base), next, datedWorkOrder: Boolean(planning?.dueDate ?? wo.startDate) };
  }

  /**
   * Rattrapage P3-1, lecture seule : plans calendaires dont le dernier OT préventif est clos
   * et dont l'échéance n'a pas dépassé celle que cet OT a traitée (clôtures antérieures à P3-1).
   * - Plans actifs seulement, comme le reste du service.
   * - OT sans `due_date` ni `start_date` écarté : sans échéance traitée connue, la base retomberait
   *   sur la date du plan et chaque apply le repousserait d'une période.
   * - Un plan très en retard n'avance que d'une période : le balayage génère aussitôt l'OT suivant.
   */
  async planScheduleCatchUp(): Promise<ScheduleCatchUp[]> {
    const plans = await db
      .select({ id: maintenanceSchedules.id, title: maintenanceSchedules.title, registrationNumber: vehicles.registrationNumber })
      .from(maintenanceSchedules)
      .innerJoin(vehicles, eq(vehicles.id, maintenanceSchedules.vehicleId))
      .where(
        and(
          eq(maintenanceSchedules.isActive, true),
          ne(maintenanceSchedules.frequency, 'mileage'),
          isNotNull(maintenanceSchedules.scheduledDate),
        ),
      )
      .orderBy(asc(maintenanceSchedules.id));
    const out: ScheduleCatchUp[] = [];
    for (const { id, title, registrationNumber } of plans) {
      const [last] = await db
        .select({ id: workOrders.id, status: workOrders.status })
        .from(workOrders)
        .where(and(eq(workOrders.maintenanceScheduleId, id), eq(workOrders.isPreventive, true)))
        .orderBy(desc(workOrders.id))
        .limit(1);
      if (last?.status !== 'completed') continue;
      const step = await this.nextScheduleStep(last.id);
      if (!step || !step.datedWorkOrder || toDay(step.plan.scheduledDate!) > step.base) continue;
      out.push({
        scheduleId: id,
        workOrderId: last.id,
        registrationNumber,
        title,
        currentDate: toDay(step.plan.scheduledDate!),
        targetDate: step.next,
      });
    }
    log.info({ count: out.length }, "Rattrapage P3-1 : plans préventifs bloqués (aperçu)");
    return out;
  }

  /** Rattrapage P3-1, écriture : même règle et même UPDATE conditionnel que la clôture. Idempotent. */
  async applyScheduleCatchUp(): Promise<ScheduleCatchUp[]> {
    const applied: ScheduleCatchUp[] = [];
    for (const c of await this.planScheduleCatchUp()) {
      if (await this.advanceScheduleAfterCompletion(c.workOrderId)) applied.push(c);
    }
    log.info({ count: applied.length }, "Rattrapage P3-1 : plans préventifs avancés");
    return applied;
  }

  /**
   * Clôture d'un OT : avance le plan sans jamais faire échouer la clôture (l'échec est journalisé).
   */
  async onWorkOrderCompleted(workOrderId: number): Promise<void> {
    try {
      await this.advanceScheduleAfterCompletion(workOrderId);
    } catch (err) {
      log.error({ err, workOrderId }, "Plan préventif : échéance non avancée après clôture de l'OT");
    }
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

      log.info(`✅ Maintenance terminée et prochaine planifiée pour le ${nextDueDate.toLocaleDateString('fr-FR')}`);
      
      return updatedSchedule;
    } catch (error) {
      log.error({ err: error }, 'Error completing maintenance and scheduling next');
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
      log.error({ err: error }, 'Error deactivating schedule');
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
      log.error({ err: error }, 'Error reactivating schedule');
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
      log.error({ err: error }, 'Error getting maintenance statistics');
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
