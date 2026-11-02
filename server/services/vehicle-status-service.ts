import { and, eq, gte, inArray, ne, count, sql } from "drizzle-orm";
import { db } from "../db";
import { vehicles, statusHistory, workOrders, fleetKpiCache, users } from "@shared/schema";
import { describeStatusChange } from "@shared/constants/vehicle-status";

export class VehicleStatusService {
  
  /**
   * Obtient les statistiques actuelles de la flotte
   */
  async getFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }> {
    try {
      const stats = await db
        .select({
          status: vehicles.status,
          count: count()
        })
        .from(vehicles)
        .groupBy(vehicles.status);

      const result = {
        operational: 0,
        maintenance: 0,
        outOfService: 0
      };

      stats.forEach(stat => {
        switch (stat.status) {
          case 'operational':
            result.operational = stat.count;
            break;
          case 'maintenance':
            result.maintenance = stat.count;
            break;
          case 'out_of_service':
            result.outOfService = stat.count;
            break;
        }
      });

      return result;
    } catch (error) {
      console.error('Error getting fleet statistics:', error);
      return { operational: 0, maintenance: 0, outOfService: 0 };
    }
  }

  /**
   * Obtient l'historique des statuts de flotte pour une période donnée
   */
  async getFleetStatusHistory(period: 'week' | 'month' | 'quarter' | 'year'): Promise<any[]> {
    try {
      // Utiliser les vraies données historiques pour chaque période
      switch (period) {
        case 'week':
          return await this.formatWeeklyData();
        case 'month':
          return await this.formatMonthlyData();
        case 'quarter':
          return await this.formatQuarterlyData();
        case 'year':
          return await this.formatYearlyData();
        default:
          return await this.formatWeeklyData();
      }
    } catch (error) {
      console.error('Error getting status history by period:', error);
      return [];
    }
  }

  /**
   * Formate les données pour la vue hebdomadaire - 7 derniers jours incluant aujourd'hui
   */
  private async formatWeeklyData(): Promise<any[]> {
    const weeklyData: any[] = [];
    const now = new Date();
    
    // Générer les 7 derniers jours (incluant aujourd'hui)
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - i);
      targetDate.setHours(0, 0, 0, 0);
      
      const dayName = targetDate.toLocaleDateString('fr-FR', { weekday: 'short' });
      const dateStr = targetDate.toISOString().split('T')[0];
      
      // Obtenir le statut de chaque véhicule à cette date
      const dailyStatus = await this.getFleetStatusAtDate(dateStr);
      
      weeklyData.push({
        date: dayName,
        operational: dailyStatus.operational,
        maintenance: dailyStatus.maintenance,
        outOfService: dailyStatus.outOfService
      });
    }
    
    return weeklyData;
  }

  /**
   * Formate les données pour la vue mensuelle - jours du mois en cours jusqu'à aujourd'hui
   */
  private async formatMonthlyData(): Promise<any[]> {
    const monthlyData: any[] = [];
    const now = new Date();
    const currentDay = now.getDate();
    
    // Pour chaque jour du mois courant jusqu'à aujourd'hui
    for (let day = 1; day <= currentDay; day++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth(), day);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      // Obtenir le statut de chaque véhicule à cette date
      const dailyStatus = await this.getFleetStatusAtDate(dateStr);
      
      monthlyData.push({
        date: `${day}`,
        operational: dailyStatus.operational,
        maintenance: dailyStatus.maintenance,
        outOfService: dailyStatus.outOfService
      });
    }
    
    return monthlyData;
  }

  /**
   * Formate les données pour la vue trimestrielle - mois du trimestre en cours
   */
  private async formatQuarterlyData(): Promise<any[]> {
    const quarterlyData: any[] = [];
    const now = new Date();
    const currentMonth = now.getMonth();
    
    // Déterminer le trimestre actuel (0-2, 3-5, 6-8, 9-11)
    const quarterStart = Math.floor(currentMonth / 3) * 3;
    
    // Générer les données pour chaque mois du trimestre en cours
    for (let i = 0; i <= currentMonth - quarterStart; i++) {
      const monthIndex = quarterStart + i;
      // Utiliser le dernier jour du mois comme référence
      const monthDate = new Date(now.getFullYear(), monthIndex + 1, 0);
      const monthName = monthDate.toLocaleDateString('fr-FR', { month: 'short' });
      const dateStr = monthDate.toISOString().split('T')[0];
      
      // Obtenir le statut de la flotte à cette date
      const monthlyStatus = await this.getFleetStatusAtDate(dateStr);
      
      quarterlyData.push({
        date: monthName,
        operational: monthlyStatus.operational ?? 0,
        maintenance: monthlyStatus.maintenance ?? 0,
        outOfService: monthlyStatus.outOfService ?? 0
      });
    }
    
    return quarterlyData;
  }

  /**
   * Formate les données pour la vue annuelle - mois de l'année en cours
   */
  private async formatYearlyData(): Promise<any[]> {
    const yearlyData: any[] = [];
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 
                       'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const now = new Date();
    const currentMonth = now.getMonth();
    
    // Générer les données pour les mois déjà passés de l'année courante (incluant le mois courant)
    for (let month = 0; month <= currentMonth; month++) {
      // Utiliser le dernier jour du mois comme référence
      const monthDate = new Date(now.getFullYear(), month + 1, 0);
      const dateStr = monthDate.toISOString().split('T')[0];
      
      const monthlyStatus = await this.getFleetStatusAtDate(dateStr);
      
      yearlyData.push({
        date: monthNames[month],
        operational: monthlyStatus.operational ?? 0,
        maintenance: monthlyStatus.maintenance ?? 0,
        outOfService: monthlyStatus.outOfService ?? 0
      });
    }
    
    return yearlyData;
  }



  /**
   * Enregistre automatiquement un changement de statut avec validation de date
   */
  async recordStatusChange(vehicleId: number, newStatus: string, oldStatus: string, updatedById?: number, reason?: string): Promise<void> {
    try {
      const vehicle = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      if (!vehicle.length) return;

      const currentDate = new Date().toISOString().split('T')[0];
      const vehicleCreationDate = vehicle[0].createdAt.toISOString().split('T')[0];
      
      // Assurer que la date n'est pas antérieure à la création du véhicule
      const validDate = currentDate >= vehicleCreationDate ? currentDate : vehicleCreationDate;

      await db.insert(statusHistory).values({
        vehicleId: vehicleId,
        status: newStatus as any,
        date: validDate,
        // Sans raison explicite, on ne prétend pas connaître l'origine: le
        // libellé précédent affirmait « automatiquement » y compris quand un
        // humain venait de cliquer dans la fiche véhicule.
        notes: reason || describeStatusChange("system", newStatus, oldStatus),
        updatedById: updatedById || null,
      });

      console.log(`Historique de statut enregistré pour le véhicule ${vehicle[0].registrationNumber}: ${oldStatus} -> ${newStatus}`);
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement de l\'historique du statut:', error);
    }
  }

  /**
   * Change automatiquement le statut d'un véhicule en maintenance
   */
  async setVehicleToMaintenance(
    vehicleId: number,
    workOrderId: number,
    updatedById?: number,
    /**
     * Cause de l'immobilisation, telle qu'elle sera lue dans l'historique.
     * Par defaut: OT cree manuellement. Le declencheur preventif passe la
     * sienne — sans quoi rien ne distingue « le chef a ouvert un OT » de
     * « le planificateur a immobilise le camion tout seul ».
     */
    raison?: string,
  ): Promise<void> {
    try {
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      // Seul un véhicule en service est immobilisé : hors service (décision manuelle) reste hors
      // service, maintenance reste maintenance (aligné sur trg_work_orders_hold_vehicle).
      if (!vehicle || vehicle.status !== 'operational') return;

      await db.update(vehicles).set({ status: 'maintenance' }).where(eq(vehicles.id, vehicleId));
      
      // Enregistrer la raison spécifique du changement
      await this.recordStatusChange(
        vehicleId, 
        'maintenance', 
        vehicle.status, 
        updatedById,
        raison ?? `Véhicule passé en maintenance - Ordre de travail #${workOrderId} créé`,
      );
    } catch (error) {
      console.error('Erreur lors du passage en maintenance:', error);
    }
  }

  /**
   * Remet automatiquement un véhicule en service
   */
  async setVehicleToOperational(vehicleId: number, workOrderId: number, updatedById?: number): Promise<void> {
    try {
      const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      // Seul un véhicule en maintenance est remis en service : hors service (décision manuelle)
      // ou déjà en service, la clôture d'un OT ne change rien (aligné sur trg_work_orders_release_vehicle).
      if (!vehicle || vehicle.status !== 'maintenance') return;

      // Un véhicule peut porter plusieurs OT en parallèle (moteur + pneus).
      // Clôturer l'un ne le rend pas apte: il reste au pont pour les autres.
      // Sans ce contrôle, le camion repassait « opérationnel » et redevenait
      // affectable à une mission alors qu'il était encore en réparation.
      const [autreOtOuvert] = await db
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.vehicleId, vehicleId),
            ne(workOrders.id, workOrderId),
            inArray(workOrders.status, ['pending', 'in_progress', 'awaiting_parts']),
          ),
        )
        .limit(1);

      if (autreOtOuvert) {
        console.log(
          `Véhicule ${vehicleId} maintenu en maintenance: OT #${autreOtOuvert.id} encore ouvert.`,
        );
        return;
      }

      await db.update(vehicles).set({ status: 'operational' }).where(eq(vehicles.id, vehicleId));
      
      // Enregistrer la raison spécifique du changement
      await this.recordStatusChange(
        vehicleId, 
        'operational', 
        vehicle.status, 
        updatedById,
        `Véhicule remis en service - Ordre de travail #${workOrderId} terminé`
      );
    } catch (error) {
      console.error('Erreur lors de la remise en service:', error);
    }
  }

  /**
   * Met à jour le statut d'un véhicule avec enregistrement automatique de l'historique
   */
  async updateVehicleStatus(vehicleId: number, newStatus: 'operational' | 'maintenance' | 'out_of_service', updatedById?: number, reason?: string): Promise<void> {
    try {
      const [currentVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
      if (!currentVehicle) return;

      if (currentVehicle.status !== newStatus) {
        await db.update(vehicles).set({ status: newStatus }).where(eq(vehicles.id, vehicleId));
        await this.recordStatusChange(vehicleId, newStatus, currentVehicle.status, updatedById, reason);
      }
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
    }
  }

  /**
   * Calcule les KPI essentiels du CMMS depuis le cache optimisé
   */
  async getFleetKPI(): Promise<{
    availabilityRate: number,
    mtbf: number, // Mean Time Between Failures
    mttr: number, // Mean Time To Repair
    maintenanceCostPerVehicle: number,
    downtimeHours: number
  }> {
    try {
      // Lecture depuis le cache pour performance optimale
      const cachedKPI = await db
        .select()
        .from(fleetKpiCache)
        .where(eq(fleetKpiCache.id, 1))
        .limit(1);

      if (cachedKPI.length > 0) {
        const kpi = cachedKPI[0];
        return {
          availabilityRate: kpi.availabilityRate,
          mtbf: kpi.mtbf,
          mttr: kpi.mttr,
          maintenanceCostPerVehicle: parseFloat(kpi.maintenanceCostPerVehicle.toString()),
          downtimeHours: kpi.downtimeHours
        };
      }

      // Fallback : recalcul si pas de cache (ne devrait jamais arriver grâce aux triggers)
      console.warn('Cache KPI non trouvé, recalcul en cours...');
      await this.forceRecalculateKPI();
      
      // Nouvelle tentative de lecture
      const newCachedKPI = await db
        .select()
        .from(fleetKpiCache)
        .where(eq(fleetKpiCache.id, 1))
        .limit(1);

      if (newCachedKPI.length > 0) {
        const kpi = newCachedKPI[0];
        return {
          availabilityRate: kpi.availabilityRate,
          mtbf: kpi.mtbf,
          mttr: kpi.mttr,
          maintenanceCostPerVehicle: parseFloat(kpi.maintenanceCostPerVehicle.toString()),
          downtimeHours: kpi.downtimeHours
        };
      }

      // Si toujours pas de cache, retourner des valeurs par défaut
      return {
        availabilityRate: 0,
        mtbf: 0,
        mttr: 0,
        maintenanceCostPerVehicle: 0,
        downtimeHours: 0
      };
    } catch (error) {
      console.error('Error reading fleet KPI from cache:', error);
      return {
        availabilityRate: 0,
        mtbf: 0,
        mttr: 0,
        maintenanceCostPerVehicle: 0,
        downtimeHours: 0
      };
    }
  }

  /**
   * Recalcule et persiste les KPI côté application
   * (fallback quand la fonction SQL calculate_fleet_kpi() est absente)
   */
  private async recalculateAndPersistKpiFallback(): Promise<void> {
    const fleetStats = await this.getFleetStatistics();
    const totalVehicles = fleetStats.operational + fleetStats.maintenance + fleetStats.outOfService;

    const availabilityRate = totalVehicles > 0
      ? Number(((fleetStats.operational / totalVehicles) * 100).toFixed(2))
      : 0;

    const workOrderAggregation = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_work_orders,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_work_orders,
        COUNT(*) FILTER (WHERE COALESCE(is_preventive, false) = false)::int AS corrective_work_orders,
        COALESCE(SUM(COALESCE(cost, 0)), 0)::numeric AS total_maintenance_cost,
        COALESCE(SUM(
          CASE
            WHEN status = 'completed' THEN
              COALESCE(duration, EXTRACT(EPOCH FROM (end_date - start_date)) / 60, 0)
            ELSE 0
          END
        ), 0)::numeric AS total_completed_minutes
      FROM work_orders
    `);

    const row = (workOrderAggregation.rows[0] as any) || {};
    const totalWorkOrders = Number(row.total_work_orders || 0);
    const completedWorkOrders = Number(row.completed_work_orders || 0);
    const correctiveWorkOrders = Number(row.corrective_work_orders || 0);
    const totalMaintenanceCost = Number(row.total_maintenance_cost || 0);
    const totalCompletedMinutes = Number(row.total_completed_minutes || 0);

    const mttr = completedWorkOrders > 0
      ? Number((totalCompletedMinutes / completedWorkOrders / 60).toFixed(2))
      : 0;

    const downtimeHours = Math.round(totalCompletedMinutes / 60);

    // Approximation en jours glissants (30 jours) en l'absence de fonction SQL dédiée.
    const mtbf = correctiveWorkOrders > 0 && totalVehicles > 0
      ? Number(((30 * totalVehicles) / correctiveWorkOrders).toFixed(2))
      : 0;

    const maintenanceCostPerVehicle = totalVehicles > 0
      ? Number((totalMaintenanceCost / totalVehicles).toFixed(2))
      : 0;

    await db.execute(sql`
      INSERT INTO fleet_kpi_cache (
        id,
        availability_rate,
        mtbf,
        mttr,
        maintenance_cost_per_vehicle,
        downtime_hours,
        total_vehicles,
        operational_vehicles,
        maintenance_vehicles,
        out_of_service_vehicles,
        total_work_orders,
        completed_work_orders,
        corrective_work_orders,
        total_maintenance_cost,
        calculated_at,
        updated_at
      ) VALUES (
        1,
        ${availabilityRate},
        ${mtbf},
        ${mttr},
        ${maintenanceCostPerVehicle},
        ${downtimeHours},
        ${totalVehicles},
        ${fleetStats.operational},
        ${fleetStats.maintenance},
        ${fleetStats.outOfService},
        ${totalWorkOrders},
        ${completedWorkOrders},
        ${correctiveWorkOrders},
        ${totalMaintenanceCost},
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        availability_rate = EXCLUDED.availability_rate,
        mtbf = EXCLUDED.mtbf,
        mttr = EXCLUDED.mttr,
        maintenance_cost_per_vehicle = EXCLUDED.maintenance_cost_per_vehicle,
        downtime_hours = EXCLUDED.downtime_hours,
        total_vehicles = EXCLUDED.total_vehicles,
        operational_vehicles = EXCLUDED.operational_vehicles,
        maintenance_vehicles = EXCLUDED.maintenance_vehicles,
        out_of_service_vehicles = EXCLUDED.out_of_service_vehicles,
        total_work_orders = EXCLUDED.total_work_orders,
        completed_work_orders = EXCLUDED.completed_work_orders,
        corrective_work_orders = EXCLUDED.corrective_work_orders,
        total_maintenance_cost = EXCLUDED.total_maintenance_cost,
        calculated_at = EXCLUDED.calculated_at,
        updated_at = NOW()
    `);
  }

  /**
   * Force le recalcul des KPI (fonction SQL si disponible, sinon fallback applicatif)
   */
  async forceRecalculateKPI(): Promise<void> {
    try {
      await db.execute(sql`SELECT calculate_fleet_kpi()`);
      return;
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError?.code === "42883") {
        console.warn("Fonction SQL calculate_fleet_kpi() absente, fallback applicatif activé.");
      } else {
        console.warn("Échec recalcul KPI via SQL, fallback applicatif activé.", error);
      }
    }

    try {
      await this.recalculateAndPersistKpiFallback();
    } catch (fallbackError) {
      console.error("Error forcing KPI recalculation (fallback):", fallbackError);
    }
  }

  /**
   * Calcule le statut de la flotte à une date donnée en sécurisant les données historiques
   */
  private async getFleetStatusAtDate(targetDate: string): Promise<{ operational: number, maintenance: number, outOfService: number }> {
    try {
      // Requête SQL sécurisée qui évite les "lignes fantômes"
      const statusAtDate = await db.execute(sql`
        WITH vehicles_existing_at_date AS (
          -- Véhicules qui existaient à cette date
          SELECT v.id
          FROM vehicles v
          WHERE v.created_at::date <= ${targetDate}
        ),
        latest_status AS (
          SELECT DISTINCT ON (sh.vehicle_id)
            sh.vehicle_id,
            sh.status
          FROM status_history sh
          JOIN vehicles v ON v.id = sh.vehicle_id
          INNER JOIN vehicles_existing_at_date ve ON sh.vehicle_id = ve.id
          WHERE sh.date <= ${targetDate}
            AND sh.date >= v.created_at::date
          ORDER BY sh.vehicle_id, sh.date DESC, sh.created_at DESC
        )
        SELECT 
          COUNT(*) FILTER (WHERE status = 'operational') as operational,
          COUNT(*) FILTER (WHERE status = 'maintenance') as maintenance,
          COUNT(*) FILTER (WHERE status = 'out_of_service') as out_of_service
        FROM latest_status
      `);

      const result = statusAtDate.rows[0] as any;
      
      return {
        operational: parseInt(result.operational) || 0,
        maintenance: parseInt(result.maintenance) || 0,
        outOfService: parseInt(result.out_of_service) || 0
      };
    } catch (error) {
      console.error('Error calculating fleet status at date:', error);
      return { operational: 0, maintenance: 0, outOfService: 0 };
    }
  }

  /**
   * Obtient l'historique des statuts pour un véhicule spécifique
   */
  async getVehicleStatusHistory(vehicleId: number): Promise<any[]> {
    try {
      const history = await db
        .select({
          id: statusHistory.id,
          vehicleId: statusHistory.vehicleId,
          status: statusHistory.status,
          date: statusHistory.date,
          notes: statusHistory.notes,
          updatedById: statusHistory.updatedById,
          updatedBy: sql<string>`COALESCE(${users.name}, ${users.username})`,
          createdAt: statusHistory.createdAt
        })
        .from(statusHistory)
        .leftJoin(users, eq(statusHistory.updatedById, users.id))
        .where(eq(statusHistory.vehicleId, vehicleId))
        .orderBy(statusHistory.createdAt);
      
      return history;
    } catch (error) {
      console.error('Error getting vehicle status history:', error);
      return [];
    }
  }
}

export const vehicleStatusService = new VehicleStatusService();
