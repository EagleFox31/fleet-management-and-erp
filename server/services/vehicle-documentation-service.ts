import { db } from "../db";
import { vehicleDocuments, vehicles } from "@shared/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { ownedLiveVehicles } from "../lib/client-vehicle-scope";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isExpiredOn, todayUtcDateOnly } from "@shared/constants/expiry-day";

const log = moduleLogger("vehicle-documentation");

type DateValue = string | Date | null | undefined;

const toDateOnly = (value: DateValue): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return null;
};

const addDaysToDateOnly = (baseDateOnly: string, days: number): string => {
  const base = new Date(`${baseDateOnly}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

/** Expiré à J+1, le jour J valable : règle unique de `shared/constants/expiry-day.ts`. */
const isDateExpired = (value: DateValue, todayDateOnly: string): boolean =>
  isExpiredOn(toDateOnly(value), todayDateOnly);

const isDateExpiringSoon = (
  value: DateValue,
  todayDateOnly: string,
  limitDateOnly: string,
): boolean => {
  const dateOnly = toDateOnly(value);
  return dateOnly !== null && dateOnly >= todayDateOnly && dateOnly <= limitDateOnly;
};

/**
 * Service Véhicules & Documentation
 * 
 * Responsabilités :
 * - Gestion documents véhicules (27 véhicules)
 * - Alertes expiration (carte grise, assurance, visite technique)
 * - Mise à jour kilométrage temps réel
 * - Suivi position maintenance
 */
export class VehicleDocumentationService {
  /** `ownerId` : ne garder que les véhicules de ce propriétaire, retirés exclus (cloison client). */
  private async getVehiclesWithEffectiveDocumentDates(ownerId: number | null = null) {
    const [allVehicles, docs] = await Promise.all([
      db.select().from(vehicles).where(ownedLiveVehicles(ownerId)),
      db
        .select({
          vehicleId: vehicleDocuments.vehicleId,
          type: vehicleDocuments.type,
          expiryDate: vehicleDocuments.expiryDate,
        })
        .from(vehicleDocuments)
        .where(
          and(
            inArray(vehicleDocuments.type, ["carte_grise", "assurance", "visite_technique"]),
            isNotNull(vehicleDocuments.expiryDate),
          ),
        ),
    ]);

    const latestByVehicle = new Map<
      number,
      Partial<Record<"carte_grise" | "assurance" | "visite_technique", string>>
    >();

    for (const row of docs) {
      if (!row.expiryDate) continue;
      const docType = row.type as "carte_grise" | "assurance" | "visite_technique";
      if (!["carte_grise", "assurance", "visite_technique"].includes(docType)) continue;
      const expiryDate = toDateOnly(row.expiryDate);
      if (!expiryDate) continue;

      const current = latestByVehicle.get(row.vehicleId) || {};
      const currentDate = current[docType];
      if (!currentDate || expiryDate > currentDate) {
        current[docType] = expiryDate;
        latestByVehicle.set(row.vehicleId, current);
      }
    }

    return allVehicles.map((vehicle) => {
      const latest = latestByVehicle.get(vehicle.id);
      return {
        ...vehicle,
        licensePlateExpiry: latest?.carte_grise ?? vehicle.licensePlateExpiry,
        insuranceExpiry: latest?.assurance ?? vehicle.insuranceExpiry,
        technicalInspectionDate: latest?.visite_technique ?? vehicle.technicalInspectionDate,
      };
    });
  }
  
  /**
   * Récupère les documents expirant bientôt
   * Exploite: 22 véhicules avec dates documentaires
   * @param daysBeforeExpiry - Nombre de jours avant expiration (défaut: 30)
   */
  async getExpiringDocuments(daysBeforeExpiry: number = 30, ownerId: number | null = null) {
    log.debug({ daysBeforeExpiry, ownerId }, "documents expirant bientôt : lecture");

    const allVehicles = await this.getVehiclesWithEffectiveDocumentDates(ownerId);
    const nowStr = todayUtcDateOnly();
    const expiryDateStr = addDaysToDateOnly(nowStr, daysBeforeExpiry);

    const carteGrise = allVehicles.filter((v) =>
      isDateExpiringSoon(v.licensePlateExpiry, nowStr, expiryDateStr),
    );
    const assurance = allVehicles.filter((v) =>
      isDateExpiringSoon(v.insuranceExpiry, nowStr, expiryDateStr),
    );
    const visiteTechnique = allVehicles.filter((v) =>
      isDateExpiringSoon(v.technicalInspectionDate, nowStr, expiryDateStr),
    );
    
    // Documents jamais renseignés. Ils n'expirent pas, donc ils échappaient à
    // toutes les alertes — un véhicule sans date d'assurance était invisible,
    // alors que c'est précisément celui dont on ne sait rien. Ni « à jour »,
    // ni « expiré »: absent.
    const nonRenseignes = allVehicles
      .map((v) => ({
        vehicle: v,
        manquants: [
          !v.licensePlateExpiry ? ("carte_grise" as const) : null,
          !v.insuranceExpiry ? ("assurance" as const) : null,
          !v.technicalInspectionDate ? ("visite_technique" as const) : null,
        ].filter((type): type is "carte_grise" | "assurance" | "visite_technique" => type !== null),
      }))
      .filter((entree) => entree.manquants.length > 0)
      .map((entree) => ({ ...entree.vehicle, missingDocuments: entree.manquants }));

    const result = {
      carteGrise,
      assurance,
      visiteTechnique,
      nonRenseignes,
      totalExpiring: carteGrise.length + assurance.length + visiteTechnique.length,
      totalMissing: nonRenseignes.reduce((somme, v) => somme + v.missingDocuments.length, 0),
    };

    log.debug(
      { totalExpiring: result.totalExpiring, totalMissing: result.totalMissing },
      "documents expirant bientôt : résultat",
    );
    return result;
  }
  
  /**
   * Récupère les documents déjà expirés
   */
  async getExpiredDocuments(ownerId: number | null = null) {
    log.debug({ ownerId }, "documents expirés : lecture");

    const allVehicles = await this.getVehiclesWithEffectiveDocumentDates(ownerId);
    const nowStr = todayUtcDateOnly();

    const expiredVehicles = allVehicles.filter((v) =>
      isDateExpired(v.licensePlateExpiry, nowStr) ||
      isDateExpired(v.insuranceExpiry, nowStr) ||
      isDateExpired(v.technicalInspectionDate, nowStr),
    );

    const result = expiredVehicles.map(vehicle => ({
      ...vehicle,
      expiredDocuments: [
        isDateExpired(vehicle.licensePlateExpiry, nowStr)
          ? { type: 'carte_grise', expiryDate: vehicle.licensePlateExpiry }
          : null,
        isDateExpired(vehicle.insuranceExpiry, nowStr)
          ? { type: 'assurance', expiryDate: vehicle.insuranceExpiry }
          : null,
        isDateExpired(vehicle.technicalInspectionDate, nowStr)
          ? { type: 'visite_technique', expiryDate: vehicle.technicalInspectionDate }
          : null,
      ].filter(Boolean)
    }));
    
    log.debug({ count: result.length }, "documents expirés : résultat");
    return result;
  }
  
  /**
   * Mise à jour kilométrage temps réel
   * Exploite: currentKilometers (27 véhicules)
   */
  async updateMileage(vehicleId: number, kilometers: number) {
    log.debug({ vehicleId, kilometers }, "kilométrage : mise à jour");

    const [currentVehicle] = await db
      .select({
        id: vehicles.id,
        mileage: vehicles.mileage,
        lastMileage: vehicles.lastMileage,
        currentKilometers: vehicles.currentKilometers,
      })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);

    if (!currentVehicle) {
      throw new AppError(404, "Véhicule introuvable.");
    }

    const currentMileage = Math.max(
      currentVehicle.lastMileage ?? 0,
      currentVehicle.mileage ?? 0,
      currentVehicle.currentKilometers ?? 0
    );

    if (kilometers < currentMileage) {
      throw new AppError(
        400,
        `Le kilométrage saisi (${kilometers} km) est inférieur au kilométrage actuel (${currentMileage} km)`
      );
    }
    
    const [updated] = await db
      .update(vehicles)
      .set({ 
        currentKilometers: kilometers,
        mileage: kilometers,
        lastMileage: kilometers,
      })
      .where(eq(vehicles.id, vehicleId))
      .returning();
    
    log.debug({ vehicleId }, "kilométrage : mis à jour");
    return updated;
  }
  
  /**
   * Suivi position maintenance
   * Exploite: maintenancePosition
   */
  async updateMaintenancePosition(vehicleId: number, position: string) {
    log.debug({ vehicleId, position }, "position maintenance : mise à jour");
    
    const [updated] = await db
      .update(vehicles)
      .set({ maintenancePosition: position })
      .where(eq(vehicles.id, vehicleId))
      .returning();
    
    if (!updated) {
      throw new AppError(404, "Véhicule introuvable.");
    }
    
    log.debug({ vehicleId }, "position maintenance : mise à jour faite");
    return updated;
  }
  
  /**
   * Statistiques documents par type
   */
  async getDocumentStats(ownerId: number | null = null) {
    log.debug({ ownerId }, "statistiques documents : calcul");

    const allVehicles = await this.getVehiclesWithEffectiveDocumentDates(ownerId);
    
    const todayDateOnly = todayUtcDateOnly();
    const expiryDateOnly = addDaysToDateOnly(todayDateOnly, 30);
    
    // Compter documents valides, expirant bientôt, expirés
    const withCarteGrise = allVehicles.filter(v => v.licensePlateExpiry).length;
    const expiringCarteGrise = allVehicles.filter(v => 
      isDateExpiringSoon(v.licensePlateExpiry, todayDateOnly, expiryDateOnly)
    ).length;
    const expiredCarteGrise = allVehicles.filter(v => 
      isDateExpired(v.licensePlateExpiry, todayDateOnly)
    ).length;
    
    const withAssurance = allVehicles.filter(v => v.insuranceExpiry).length;
    const expiringAssurance = allVehicles.filter(v => 
      isDateExpiringSoon(v.insuranceExpiry, todayDateOnly, expiryDateOnly)
    ).length;
    const expiredAssurance = allVehicles.filter(v => 
      isDateExpired(v.insuranceExpiry, todayDateOnly)
    ).length;
    
    const withVisiteTechnique = allVehicles.filter(v => v.technicalInspectionDate).length;
    const expiringVisiteTechnique = allVehicles.filter(v => 
      isDateExpiringSoon(v.technicalInspectionDate, todayDateOnly, expiryDateOnly)
    ).length;
    const expiredVisiteTechnique = allVehicles.filter(v => 
      isDateExpired(v.technicalInspectionDate, todayDateOnly)
    ).length;
    
    const stats = {
      total: allVehicles.length,
      withCarteGrise,
      expiringCarteGrise,
      expiredCarteGrise,
      validCarteGrise: withCarteGrise - expiringCarteGrise - expiredCarteGrise,
      withAssurance,
      expiringAssurance,
      expiredAssurance,
      validAssurance: withAssurance - expiringAssurance - expiredAssurance,
      withVisiteTechnique,
      expiringVisiteTechnique,
      expiredVisiteTechnique,
      validVisiteTechnique: withVisiteTechnique - expiringVisiteTechnique - expiredVisiteTechnique,
    };
    
    log.debug({ stats }, "statistiques documents : résultat");
    return stats;
  }
  
  /**
   * Récupère tous les véhicules avec leurs informations documentaires
   */
  async getAllVehiclesWithDocStatus(ownerId: number | null = null) {
    log.debug({ ownerId }, "véhicules avec statut documents : lecture");

    const todayDateOnly = todayUtcDateOnly();
    const expiryDateOnly = addDaysToDateOnly(todayDateOnly, 30);
    const allVehicles = await this.getVehiclesWithEffectiveDocumentDates(ownerId);
    
    return allVehicles.map(vehicle => {
      const carteGriseStatus = vehicle.licensePlateExpiry
        ? isDateExpired(vehicle.licensePlateExpiry, todayDateOnly)
          ? 'expired'
          : isDateExpiringSoon(vehicle.licensePlateExpiry, todayDateOnly, expiryDateOnly)
            ? 'expiring'
            : 'valid'
        : 'missing';
      
      const assuranceStatus = vehicle.insuranceExpiry
        ? isDateExpired(vehicle.insuranceExpiry, todayDateOnly)
          ? 'expired'
          : isDateExpiringSoon(vehicle.insuranceExpiry, todayDateOnly, expiryDateOnly)
            ? 'expiring'
            : 'valid'
        : 'missing';
      
      const visiteTechniqueStatus = vehicle.technicalInspectionDate
        ? isDateExpired(vehicle.technicalInspectionDate, todayDateOnly)
          ? 'expired'
          : isDateExpiringSoon(vehicle.technicalInspectionDate, todayDateOnly, expiryDateOnly)
            ? 'expiring'
            : 'valid'
        : 'missing';
      
      return {
        ...vehicle,
        documentStatus: {
          carteGrise: carteGriseStatus,
          assurance: assuranceStatus,
          visiteTechnique: visiteTechniqueStatus,
          hasIssues: carteGriseStatus === 'expired' || 
                     assuranceStatus === 'expired' || 
                     visiteTechniqueStatus === 'expired' ||
                     carteGriseStatus === 'expiring' || 
                     assuranceStatus === 'expiring' || 
                     visiteTechniqueStatus === 'expiring'
        }
      };
    });
  }

  /** Propriétaire du véhicule (`undefined` si le véhicule n'existe pas). */
  async getVehicleOwnerId(vehicleId: number): Promise<number | null | undefined> {
    const [row] = await db
      .select({ ownerId: vehicles.ownerId })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .limit(1);
    return row?.ownerId;
  }
}

// Singleton instance
export const vehicleDocumentationService = new VehicleDocumentationService();
