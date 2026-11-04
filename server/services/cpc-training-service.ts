import { db } from "../db";
import { drivers, type Driver } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
    
    const now = new Date();
    const trainingDate = new Date(cpcDate);
    
    // Date d'expiration = date formation + 731 jours
    const expiryDate = new Date(trainingDate);
    expiryDate.setDate(expiryDate.getDate() + 731);
    
    // Date d'alerte = aujourd'hui + 59 jours
    const alertDate = new Date(now);
    alertDate.setDate(alertDate.getDate() + 59);
    
    return expiryDate > alertDate ? 'FORMÉ' : 'À FORMER';
  }
  
  /**
   * Récupère tous les chauffeurs avec statut CPC
   * Exploite: 27 chauffeurs avec firstName, lastName
   */
  async getAllDriversStatus() {
    console.log("Fetching all drivers with CPC status...");
    
    const allDrivers = await db.select().from(drivers);
    
    return allDrivers.map(driver => {
      const expiryDate = driver.cpcTrainingDate ? 
        new Date(new Date(driver.cpcTrainingDate).getTime() + 731 * 24 * 60 * 60 * 1000) : null;
      
      const daysRemaining = expiryDate ? 
        Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
      
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
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
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
    console.log("Fetching expiring CPC alerts...");
    
    const statuses = await this.getAllDriversStatus();
    const alerts = statuses.filter(s => s.cpcStatus === 'À FORMER' && s.isActive);
    
    console.log(`Found ${alerts.length} drivers requiring CPC training renewal`);
    return alerts;
  }
  
  /**
   * Mise à jour certification CPC
   */
  async updateCPCCertification(driverId: number, newDate: Date) {
    console.log(`Updating CPC certification for driver ${driverId} to ${newDate}`);
    
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
    
    console.log(`CPC certification updated for driver ${driverId}, new status: ${newStatus}`);
    return updated;
  }
  
  /**
   * Statistiques formations par statut
   */
  async getCPCStatistics() {
    console.log("Calculating CPC statistics...");
    
    const statuses = await this.getAllDriversStatus();
    const activeDrivers = statuses.filter(s => s.isActive);
    
    const stats = {
      total: activeDrivers.length,
      forme: activeDrivers.filter(s => s.cpcStatus === 'FORMÉ').length,
      aFormer: activeDrivers.filter(s => s.cpcStatus === 'À FORMER').length,
      nonForme: activeDrivers.filter(s => s.cpcStatus === 'NON FORMÉ').length,
      inactiveDrivers: statuses.filter(s => !s.isActive).length
    };
    
    console.log("CPC statistics calculated:", stats);
    return stats;
  }
  
  /**
   * Récupère un chauffeur avec son statut CPC
   */
  async getDriverWithCPCStatus(driverId: number) {
    console.log(`Fetching driver ${driverId} with CPC status...`);
    
    const [driver] = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driverId));
    
    if (!driver) {
      throw new Error(`Chauffeur ${driverId} non trouvé`);
    }
    
    const expiryDate = driver.cpcTrainingDate ? 
      new Date(new Date(driver.cpcTrainingDate).getTime() + 731 * 24 * 60 * 60 * 1000) : null;
    
    const daysRemaining = expiryDate ? 
      Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
    
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
    console.log("Synchronizing all CPC statuses...");
    
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
    
    console.log(`Synchronized ${updated} CPC statuses out of ${allDrivers.length} drivers`);
    return { total: allDrivers.length, updated };
  }
}

// Singleton instance
export const cpcTrainingService = new CPCTrainingService();
