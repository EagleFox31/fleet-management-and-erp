import { db } from "../db";
import { vehicles, statusHistory } from "@shared/schema";
import { eq, gte, and, count, sql } from "drizzle-orm";

export class FleetStatisticsService {
  
  /**
   * Obtient l'historique des statuts de flotte pour une période donnée
   * Utilise les vraies données de la table status_history
   */
  async getFleetStatusHistory(period: 'week' | 'month' | 'quarter' | 'year'): Promise<any[]> {
    try {
      const now = new Date();
      let dateLimit: Date;

      // Calculer la date limite selon la période
      switch (period) {
        case 'week':
          dateLimit = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          dateLimit = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'quarter':
          dateLimit = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          dateLimit = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          dateLimit = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      // Récupérer les données d'historique depuis la base
      const historyData = await db
        .select({
          date: statusHistory.date,
          status: statusHistory.status,
          vehicleId: statusHistory.vehicleId,
          vehicleRegistration: sql<string>`${vehicles.registrationNumber}`.as('vehicleRegistration')
        })
        .from(statusHistory)
        .leftJoin(vehicles, eq(statusHistory.vehicleId, vehicles.id))
        .where(gte(statusHistory.date, dateLimit.toISOString().split('T')[0]))
        .orderBy(statusHistory.date);

      // Obtenir les statistiques actuelles de la flotte
      const currentStats = await this.getCurrentFleetStatistics();

      // Formater selon la période
      switch (period) {
        case 'week':
          return this.formatWeeklyHistoryData(historyData, currentStats, now);
        case 'month':
          return this.formatMonthlyHistoryData(historyData, currentStats, now);
        case 'quarter':
          return this.formatQuarterlyHistoryData(historyData, currentStats, now);
        case 'year':
          return this.formatYearlyHistoryData(historyData, currentStats);
        default:
          return this.formatWeeklyHistoryData(historyData, currentStats, now);
      }
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique des statuts:', error);
      return [];
    }
  }

  /**
   * Obtient les statistiques actuelles de la flotte
   */
  private async getCurrentFleetStatistics(): Promise<{ operational: number, maintenance: number, outOfService: number }> {
    try {
      const stats = await db
        .select({
          status: vehicles.status,
          count: count()
        })
        .from(vehicles)
        .groupBy(vehicles.status);

      const result = { operational: 0, maintenance: 0, outOfService: 0 };
      
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
      console.error('Erreur lors du calcul des statistiques actuelles:', error);
      return { operational: 0, maintenance: 0, outOfService: 0 };
    }
  }

  /**
   * Formate les données pour l'affichage hebdomadaire
   */
  private formatWeeklyHistoryData(historyData: any[], currentStats: any, now: Date): any[] {
    const weeklyData: any[] = [];
    const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    
    // Obtenir le début de la semaine (lundi)
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    // Grouper les changements par date
    const changesByDate = this.groupChangesByDate(historyData);
    
    // État actuel de chaque véhicule (dernier statut connu)
    const vehicleCurrentStatus = new Map<number, string>();
    
    // Initialiser avec les statuts actuels
    // Note: On devrait récupérer tous les véhicules et leur statut actuel
    // Pour l'instant, on utilise les stats actuelles comme référence

    // Générer les données pour chaque jour de la semaine
    for (let i = 0; i < 7; i++) {
      const currentDay = new Date(startOfWeek);
      currentDay.setDate(startOfWeek.getDate() + i);
      
      if (currentDay > now) {
        break;
      }

      const dayName = dayNames[currentDay.getDay()];
      const dayKey = currentDay.toISOString().split('T')[0];
      
      let dayStats;
      if (changesByDate[dayKey] && changesByDate[dayKey].length > 0) {
        // Il y a des changements ce jour-là
        dayStats = this.calculateStatsFromChanges(changesByDate[dayKey]);
      } else {
        // Pas de changements ce jour-là
        if (currentDay.toDateString() === now.toDateString()) {
          // Aujourd'hui : utiliser les stats actuelles
          dayStats = currentStats;
        } else {
          // Jour passé : propager le dernier état connu
          // Pour simplifier, on calcule les stats basées sur tous les changements jusqu'à cette date
          const changesUpToThisDate = historyData.filter(record => 
            new Date(record.date) <= currentDay
          );
          
          if (changesUpToThisDate.length > 0) {
            dayStats = this.calculateStatsFromChanges(changesUpToThisDate);
          } else {
            continue; // Pas de données historiques disponibles pour ce jour
          }
        }
      }

      weeklyData.push({
        date: dayName,
        operational: dayStats.operational,
        maintenance: dayStats.maintenance,
        outOfService: dayStats.outOfService
      });
    }

    return weeklyData;
  }

  /**
   * Formate les données pour l'affichage mensuel
   */
  private formatMonthlyHistoryData(historyData: any[], currentStats: any, now: Date): any[] {
    const monthlyData: any[] = [];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const changesByDate = this.groupChangesByDate(historyData);

    // Générer les données pour chaque jour du mois
    const currentDate = new Date(monthStart);
    while (currentDate <= monthEnd && currentDate <= now) {
      const dayKey = currentDate.toISOString().split('T')[0];
      const dateLabel = `${currentDate.getDate()}/${currentDate.getMonth() + 1}`;

      let dayStats;
      if (changesByDate[dayKey] && changesByDate[dayKey].length > 0) {
        // Il y a des changements ce jour-là
        dayStats = this.calculateStatsFromChanges(changesByDate[dayKey]);
      } else {
        // Pas de changements ce jour-là
        if (currentDate.toDateString() === now.toDateString()) {
          // Aujourd'hui : utiliser les stats actuelles
          dayStats = currentStats;
        } else {
          // Jour passé : propager le dernier état connu
          const changesUpToThisDate = historyData.filter(record => 
            new Date(record.date) <= currentDate
          );
          
          if (changesUpToThisDate.length > 0) {
            dayStats = this.calculateStatsFromChanges(changesUpToThisDate);
          } else {
            currentDate.setDate(currentDate.getDate() + 1);
            continue; // Pas de données historiques disponibles pour ce jour
          }
        }
      }

      monthlyData.push({
        date: dateLabel,
        operational: dayStats.operational,
        maintenance: dayStats.maintenance,
        outOfService: dayStats.outOfService
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return monthlyData;
  }

  /**
   * Formate les données pour l'affichage trimestriel
   */
  private formatQuarterlyHistoryData(historyData: any[], currentStats: any, now: Date): any[] {
    const quarterlyData: any[] = [];
    const quarterStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    const changesByDate = this.groupChangesByDate(historyData);
    
    // Générer des données hebdomadaires pour le trimestre
    for (let week = 0; week < 13; week++) {
      const weekStart = new Date(quarterStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
      
      if (weekStart > now) break;

      const weekLabel = `S${week + 1}`;
      
      // Calculer les stats réelles pour cette semaine
      let weekStats = { operational: 0, maintenance: 0, outOfService: 0 };
      let hasDataThisWeek = false;
      
      // Parcourir chaque jour de la semaine pour collecter les changements
      for (let day = 0; day < 7; day++) {
        const currentDay = new Date(weekStart.getTime() + day * 24 * 60 * 60 * 1000);
        if (currentDay > now) break;
        
        const dayKey = currentDay.toISOString().split('T')[0];
        
        if (changesByDate[dayKey]) {
          hasDataThisWeek = true;
          const dayStatsCalc = this.calculateStatsFromChanges(changesByDate[dayKey]);
          // Prendre les stats du dernier jour de la semaine avec des données
          weekStats = dayStatsCalc;
        }
      }
      
      // Si aucune donnée cette semaine et ce n'est pas la semaine actuelle, ne pas afficher
      if (!hasDataThisWeek) {
        // Vérifier si c'est la semaine actuelle
        const currentWeekStart = new Date(now);
        const dayOfWeek = currentWeekStart.getDay();
        const diff = currentWeekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        currentWeekStart.setDate(diff);
        currentWeekStart.setHours(0, 0, 0, 0);
        
        if (weekStart.getTime() === currentWeekStart.getTime()) {
          // C'est la semaine actuelle, afficher les stats d'aujourd'hui
          weekStats = currentStats;
        } else {
          continue;
        }
      }
      
      quarterlyData.push({
        date: weekLabel,
        operational: weekStats.operational,
        maintenance: weekStats.maintenance,
        outOfService: weekStats.outOfService
      });
    }

    return quarterlyData;
  }

  /**
   * Formate les données pour l'affichage annuel
   */
  private formatYearlyHistoryData(historyData: any[], currentStats: any): any[] {
    const yearlyData: any[] = [];
    const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const now = new Date();

    const changesByMonth = this.groupChangesByMonth(historyData);

    // Parcourir les mois avec des données dans l'année actuelle
    Object.keys(changesByMonth).forEach(monthKey => {
      const [year, month] = monthKey.split('-').map(Number);
      
      // Vérifier si ce mois est dans l'année actuelle
      if (year === now.getFullYear()) {
        const monthIndex = month - 1;
        const monthStats = this.calculateStatsFromChanges(changesByMonth[monthKey]);
        
        yearlyData.push({
          date: months[monthIndex],
          operational: monthStats.operational,
          maintenance: monthStats.maintenance,
          outOfService: monthStats.outOfService
        });
      }
    });

    // Ajouter le mois actuel si pas déjà inclus
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!changesByMonth[currentMonthKey]) {
      yearlyData.push({
        date: months[now.getMonth()],
        operational: currentStats.operational,
        maintenance: currentStats.maintenance,
        outOfService: currentStats.outOfService
      });
    }

    // Trier par mois
    yearlyData.sort((a, b) => {
      const monthA = months.indexOf(a.date);
      const monthB = months.indexOf(b.date);
      return monthA - monthB;
    });

    return yearlyData;
  }

  /**
   * Groupe les changements de statut par date
   */
  private groupChangesByDate(historyData: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    historyData.forEach(record => {
      const dateKey = record.date;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(record);
    });

    return grouped;
  }

  /**
   * Groupe les changements de statut par mois
   */
  private groupChangesByMonth(historyData: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    historyData.forEach(record => {
      const date = new Date(record.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[monthKey]) {
        grouped[monthKey] = [];
      }
      grouped[monthKey].push(record);
    });

    return grouped;
  }

  /**
   * Calcule les statistiques à partir des changements de statut pour une période donnée
   * Prend le dernier statut de chaque véhicule dans la période
   */
  private calculateStatsFromChanges(changes: any[]): { operational: number, maintenance: number, outOfService: number } {
    const vehicleStatuses = new Map<number, string>();
    
    // Trier les changements par date pour prendre le plus récent par véhicule
    const sortedChanges = changes.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Garder le dernier statut de chaque véhicule
    sortedChanges.forEach(change => {
      vehicleStatuses.set(change.vehicleId, change.status);
    });

    // Compter par statut final
    const stats = { operational: 0, maintenance: 0, outOfService: 0 };
    vehicleStatuses.forEach(status => {
      switch (status) {
        case 'operational':
          stats.operational++;
          break;
        case 'maintenance':
          stats.maintenance++;
          break;
        case 'out_of_service':
          stats.outOfService++;
          break;
      }
    });

    return stats;
  }

  /**
   * Enregistre un changement de statut dans l'historique
   */
  async recordStatusChange(vehicleId: number, newStatus: string, updatedById?: number, notes?: string): Promise<void> {
    try {
      await db.insert(statusHistory).values({
        vehicleId,
        status: newStatus as 'operational' | 'maintenance' | 'out_of_service',
        date: new Date().toISOString().split('T')[0],
        notes,
        updatedById
      });
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement du changement de statut:', error);
      throw error;
    }
  }
}

export const fleetStatisticsService = new FleetStatisticsService();