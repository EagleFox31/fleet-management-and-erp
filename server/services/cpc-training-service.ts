import { db } from "../db";
import { drivers, type Driver } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { cpcExpiryDayOf } from "@shared/constants/driver-cpc-eligibility";
import { addDaysToDateOnly, daysBetweenDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("cpc-training");

/** Marge d'alerte avant expiration, en jours (decision metier en attente : ne pas modifier ici). */
const CPC_ALERT_MARGIN_DAYS = 59;

/**
 * Expiration et jours restants d'une formation CPC, en jour calendaire UTC.
 * Date absente : pas d'expiration, 0 jour restant.
 */
export function computeCpcExpiry(
  cpcTrainingDate: string | Date | null | undefined,
  today: string = todayUtcDateOnly(),
): { expiryDay: string | null; daysRemaining: number } {
  const expiryDay = cpcExpiryDayOf(cpcTrainingDate);
  return { expiryDay, daysRemaining: expiryDay ? daysBetweenDateOnly(expiryDay, today) : 0 };
}

/**
 * Service CPC & Formations
 * 
 * Responsabilités :
 * - Gestion statuts CPC des chauffeurs (27 chauffeurs)
 * - Calculs automatiques selon formule CPC (731 jours validité, 59 jours alerte)
 * - Alertes formations à renouveler
 * - Statistiques formations
 * 
 * Formule CPC :
 * - FORMÉ : date CPC + 731 jours > aujourd'hui + 59 jours
 * - À FORMER : date CPC + 731 jours <= aujourd'hui + 59 jours
 * - NON FORMÉ : pas de date CPC
 */
export class CPCTrainingService {
  
  /**
   * Calcul statut CPC selon formule:
   * - FORMÉ: date CPC + 731 jours > aujourd'hui + 59 jours
   * - À FORMER: date CPC + 731 jours <= aujourd'hui + 59 jours
   * - NON FORMÉ: pas de date CPC
   */
  calculateCPCStatus(cpcDate: string | null): 'FORMÉ' | 'À FORMER' | 'NON FORMÉ' {
    if (!cpcDate) return 'NON FORMÉ';
    
    const expiryDay = cpcExpiryDayOf(cpcDate);
    // Date illisible : meme issue que le calcul d'origine (comparaison fausse), a former.
    if (!expiryDay) return 'À FORMER';
    const alertDay = addDaysToDateOnly(todayUtcDateOnly(), CPC_ALERT_MARGIN_DAYS);
    return alertDay !== null && expiryDay > alertDay ? 'FORMÉ' : 'À FORMER';
  }
  
  /**
   * Récupère tous les chauffeurs avec statut CPC
   * Exploite: 27 chauffeurs avec firstName, lastName
   */
  async getAllDriversStatus() {
    log.debug("Lecture des statuts CPC de tous les chauffeurs");
    
    const allDrivers = await db.select().from(drivers);
    
    return allDrivers.map(driver => {
      const { expiryDay, daysRemaining } = computeCpcExpiry(driver.cpcTrainingDate);
      
      return {
        id: driver.id,
        userId: driver.userId,
        firstName: driver.firstName,
        lastName: driver.lastName,
        employeeNumber: driver.employeeNumber,
        birthDate: driver.birthDate,
        cniNumber: driver.cniNumber,
        cniExpiry: driver.cniExpiry,
        licenseNumber: driver.licenseNumber,
        licenseExpiry: driver.licenseExpiry,
        hireDate: driver.hireDate,
        geoTrainingDate: driver.geoTrainingDate,
        cpcStatus: this.calculateCPCStatus(driver.cpcTrainingDate),
        // Statut enregistré en base : c'est lui que la garde d'affectation d'une mission lit.
        cpcStatusRecorded: driver.cpcStatus ?? null,
        cpcTrainingDate: driver.cpcTrainingDate,
        cpcStatusUpdatedAt: driver.cpcStatusUpdatedAt,
        expiryDate: expiryDay ? `${expiryDay}T00:00:00.000Z` : null,
        daysRemaining,
        isActive: driver.isActive,
        createdAt: driver.createdAt,
      };
    });
  }
  
  /**
   * Alertes formations CPC (59 jours avant expiration)
   */
  async getExpiringCPCAlerts() {
    log.debug("Lecture des alertes CPC");
    
    const statuses = await this.getAllDriversStatus();
    const alerts = statuses.filter(s => s.cpcStatus === 'À FORMER' && s.isActive);
    
    log.info({ count: alerts.length }, "Chauffeurs a former (CPC)");
    return alerts;
  }
  
  /**
   * Mise à jour certification CPC
   */
  async updateCPCCertification(driverId: number, newDate: Date) {
    log.info({ driverId, newDate: newDate.toISOString() }, "Mise a jour de la certification CPC");
    
    const dateStr = newDate.toISOString().split('T')[0];
    const newStatus = this.calculateCPCStatus(dateStr);
    
    const [updated] = await db
      .update(drivers)
      .set({ 
        cpcTrainingDate: dateStr,
        cpcStatus: newStatus,
        cpcStatusUpdatedAt: new Date()
      })
      .where(eq(drivers.id, driverId))
      .returning();
    
    if (!updated) {
      throw new Error(`Chauffeur ${driverId} non trouvé`);
    }
    
    log.info({ driverId, newStatus }, "Certification CPC mise a jour");
    return updated;
  }
  
  /**
   * Statistiques formations par statut
   */
  async getCPCStatistics() {
    log.debug("Calcul des statistiques CPC");
    
    const statuses = await this.getAllDriversStatus();
    const activeDrivers = statuses.filter(s => s.isActive);
    
    const stats = {
      total: activeDrivers.length,
      forme: activeDrivers.filter(s => s.cpcStatus === 'FORMÉ').length,
      aFormer: activeDrivers.filter(s => s.cpcStatus === 'À FORMER').length,
      nonForme: activeDrivers.filter(s => s.cpcStatus === 'NON FORMÉ').length,
      inactiveDrivers: statuses.filter(s => !s.isActive).length
    };
    
    log.info({ stats }, "Statistiques CPC calculees");
    return stats;
  }
  
  /**
   * Récupère un chauffeur avec son statut CPC
   */
  async getDriverWithCPCStatus(driverId: number) {
    log.debug({ driverId }, "Lecture du chauffeur avec statut CPC");
    
    const [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driverId));
    
    if (!driver) {
      throw new Error(`Chauffeur ${driverId} non trouvé`);
    }
    
    const { expiryDay, daysRemaining } = computeCpcExpiry(driver.cpcTrainingDate);
    const expiryDate = expiryDay ? new Date(`${expiryDay}T00:00:00.000Z`) : null;
    
    return {
      ...driver,
      cpcStatus: this.calculateCPCStatus(driver.cpcTrainingDate),
      expiryDate,
      daysRemaining
    };
  }
  
  /**
   * Synchronise tous les statuts CPC dans la base de données
   * Utile pour maintenance ou après import de données
   */
  async syncAllCPCStatuses() {
    log.info("Synchronisation des statuts CPC");
    
    const allDrivers = await db.select().from(drivers);
    let updated = 0;
    
    for (const driver of allDrivers) {
      const calculatedStatus = this.calculateCPCStatus(driver.cpcTrainingDate);
      
      if (driver.cpcStatus !== calculatedStatus) {
        await db
          .update(drivers)
          .set({ 
            cpcStatus: calculatedStatus,
            cpcStatusUpdatedAt: new Date()
          })
          .where(eq(drivers.id, driver.id));
        
        updated++;
      }
    }
    
    log.info({ updated, total: allDrivers.length }, "Statuts CPC synchronises");
    return { total: allDrivers.length, updated };
  }
}

// Singleton instance
export const cpcTrainingService = new CPCTrainingService();
