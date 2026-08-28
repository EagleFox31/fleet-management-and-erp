import { db } from "../db";
import { fuelRecords, users, vehicles, type FuelRecord } from "@shared/schema";
import { eq, desc, and, sql, gte, lte, isNull, inArray } from "drizzle-orm";

type FuelCardServiceErrorCode = "INSUFFICIENT_BALANCE";

type FuelCardServiceError = Error & {
  code?: FuelCardServiceErrorCode;
};

/**
 * Service Carburant Carte Rechargeable
 * 
 * Responsabilités :
 * - Gestion système carte rechargeable (crédit/débit)
 * - Solde temps réel (14,1M FCFA disponibles)
 * - Recharges et consommations
 * - Détection anomalies consommation
 * - Statistiques par véhicule/client
 */
export class FuelCardService {
  private createServiceError(message: string, code?: FuelCardServiceErrorCode): FuelCardServiceError {
    const error = new Error(message) as FuelCardServiceError;
    if (code) {
      error.code = code;
    }
    return error;
  }

  private inferPaymentModeFromNotes(notes: string | null | undefined): string | null {
    if (!notes) return null;
    const match = notes.match(/Recharge carte\s*-\s*([^-]+?)(?:\s*-\s*|$)/i);
    if (!match?.[1]) return null;
    const mode = match[1].trim();
    return mode.length > 0 ? mode : null;
  }
  
  /**
   * Récupère le solde actuel de la carte carburant
   * Exploite les 24 enregistrements août 2025 importés
   */
  async getCurrentBalance() {
    console.log("Calculating current fuel card balance...");
    
    // Calculer totaux crédits et débits
    const [totals] = await db
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${fuelRecords.creditAmount}), 0)`,
        totalDebits: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        totalLiters: sql<string>`COALESCE(SUM(CASE WHEN ${fuelRecords.debitAmount} > 0 THEN ${fuelRecords.quantity} ELSE 0 END), 0)`
      })
      .from(fuelRecords);
    
    const credits = parseFloat(totals.totalCredits || "0");
    const debits = parseFloat(totals.totalDebits || "0");
    const totalLiters = parseFloat(totals.totalLiters || "0");
    const balance = credits - debits;
    
    // Récupérer dernier crédit et dernier débit
    const [lastCredit] = await db
      .select()
      .from(fuelRecords)
      .where(sql`${fuelRecords.creditAmount} > 0`)
      .orderBy(desc(fuelRecords.date))
      .limit(1);
    
    const [lastDebit] = await db
      .select()
      .from(fuelRecords)
      .where(sql`${fuelRecords.debitAmount} > 0`)
      .orderBy(desc(fuelRecords.date))
      .limit(1);
    
    // Calculer solde en litres avec distinction explicite entre prix réel et fallback
    const fallbackPricePerLiter = 828;
    const realAvgPricePerLiter = totalLiters > 0 ? debits / totalLiters : null;
    const usedAvgPricePerLiter = realAvgPricePerLiter ?? fallbackPricePerLiter;
    const fuelBalance = usedAvgPricePerLiter > 0 ? balance / usedAvgPricePerLiter : 0;
    
    const result = {
      balance: balance,
      fuelBalance: Math.round(fuelBalance),
      totalCredits: credits,
      totalDebits: debits,
      totalLiters: totalLiters,
      lastCredit: lastCredit || null,
      lastDebit: lastDebit || null,
      // Backward compatibility field (historically consumed by UI/API)
      averagePricePerLiter: Math.round(usedAvgPricePerLiter),
      // New explicit fields for business clarity
      averagePricePerLiterUsed: Math.round(usedAvgPricePerLiter),
      averagePricePerLiterReal:
        realAvgPricePerLiter !== null && Number.isFinite(realAvgPricePerLiter)
          ? Math.round(realAvgPricePerLiter)
          : null,
      averagePricePerLiterFallback: fallbackPricePerLiter,
      priceSource:
        realAvgPricePerLiter !== null && Number.isFinite(realAvgPricePerLiter) && realAvgPricePerLiter > 0
          ? "real"
          : "fallback",
    };
    
    console.log(`Current balance: ${balance} FCFA (${Math.round(fuelBalance)} L)`);
    return result;
  }
  
  /**
   * Recharge la carte carburant (crédit)
   */
  async rechargeCard(data: {
    amount: number;
    quantity?: number;
    unitPrice?: number;
    priceSource?: "real" | "fallback" | "manual";
    date: string;
    paymentMode: string;
    orderNumber?: string;
    notes?: string;
    userId: number;
  }) {
    console.log("Recharging fuel card:", data);
    
    const amount = Number(data.amount);
    const providedQuantity = Number(data.quantity);
    const providedUnitPrice = Number(data.unitPrice);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Montant de recharge invalide");
    }

    let quantity: number;
    if (Number.isFinite(providedQuantity) && providedQuantity > 0) {
      quantity = providedQuantity;
    } else if (Number.isFinite(providedUnitPrice) && providedUnitPrice > 0) {
      quantity = amount / providedUnitPrice;
    } else {
      throw new Error("Quantité ou prix unitaire requis pour calculer la recharge");
    }

    let unitPrice: number;
    if (Number.isFinite(providedUnitPrice) && providedUnitPrice > 0) {
      unitPrice = providedUnitPrice;
    } else if (quantity > 0) {
      unitPrice = amount / quantity;
    } else {
      unitPrice = 0;
    }

    // Calculer nouveau solde
    const currentBalance = await this.getCurrentBalance();
    const newBalance = currentBalance.balance + amount;
    const newFuelBalance = currentBalance.fuelBalance + quantity;

    // Créer l'enregistrement de recharge
    const [recharge] = await db
      .insert(fuelRecords)
      .values({
        vehicleId: null, // Pas de véhicule pour une recharge
        date: data.date,
        quantity,
        fuelType: 'diesel',
        stationName: 'APPROVISIONNEMENT',
        unitPrice: unitPrice.toString(),
        paymentMode: data.paymentMode,
        orderNumber: data.orderNumber || null,
        creditAmount: amount.toString(),
        debitAmount: "0",
        balance: newBalance.toString(),
        fuelBalance: newFuelBalance.toString(),
        notes:
          data.notes ||
          `Recharge carte - ${data.paymentMode}${data.orderNumber ? ` - ${data.orderNumber}` : ""}${
            data.priceSource ? ` - prix ${data.priceSource}` : ""
          }`,
        year: new Date(data.date).getFullYear(),
        month: new Date(data.date).getMonth() + 1,
        createdBy: data.userId
      })
      .returning();

    console.log(`Card recharged: +${amount} FCFA, new balance: ${newBalance} FCFA`);
    
    return {
      recharge,
      previousBalance: currentBalance.balance,
      newBalance: newBalance,
      previousFuelBalance: currentBalance.fuelBalance,
      newFuelBalance: newFuelBalance
    };
  }
  
  /**
   * Enregistre une consommation de carburant (débit)
   */
  async recordConsumption(data: {
    vehicleId: number;
    quantity: number;
    unitPrice: number;
    date: string;
    stationName: string;
    destination: string;
    clientName?: string;
    notes?: string;
    missionId?: number;
    isPreDeparture?: boolean;
    userId: number;
  }) {
    console.log("Recording fuel consumption:", data);
    
    // Vérifier que le véhicule existe
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, data.vehicleId));
    
    if (!vehicle) {
      throw new Error(`Véhicule ${data.vehicleId} non trouvé`);
    }
    
    // Calculer coût et nouveau solde
    const cost = data.quantity * data.unitPrice;
    const currentBalance = await this.getCurrentBalance();
    
    if (cost > currentBalance.balance) {
      throw this.createServiceError(
        `Solde insuffisant (${currentBalance.balance} FCFA < ${cost} FCFA)`,
        "INSUFFICIENT_BALANCE",
      );
    }
    
    const newBalance = currentBalance.balance - cost;
    const newFuelBalance = currentBalance.fuelBalance - data.quantity;
    
    const noteSegments = [
      data.isPreDeparture ? "[PRE_DEPART]" : null,
      data.notes?.trim() || null,
      `Destination: ${data.destination}${data.clientName ? ` - Client: ${data.clientName}` : ""}`,
    ].filter((segment): segment is string => Boolean(segment && segment.trim()));

    // Créer l'enregistrement de consommation
    const [consumption] = await db
      .insert(fuelRecords)
      .values({
        vehicleId: data.vehicleId,
        missionId: data.missionId ?? null,
        date: data.date,
        quantity: data.quantity,
        cost: cost.toString(),
        fuelType: 'diesel',
        stationName: data.stationName,
        unitPrice: data.unitPrice.toString(),
        creditAmount: "0",
        debitAmount: cost.toString(),
        balance: newBalance.toString(),
        fuelBalance: Math.max(0, newFuelBalance).toString(),
        notes: noteSegments.join(" | "),
        year: new Date(data.date).getFullYear(),
        month: new Date(data.date).getMonth() + 1,
        createdBy: data.userId
      })
      .returning();
    
    console.log(`Consumption recorded: -${cost} FCFA, new balance: ${newBalance} FCFA`);
    
    return {
      consumption,
      previousBalance: currentBalance.balance,
      newBalance: newBalance,
      cost: cost
    };
  }

  async getFuelRecordsByMission(missionId: number): Promise<{
    records: Array<
      FuelRecord & {
        createdByName?: string | null;
        createdByRole?: string | null;
      }
    >;
    totalQuantity: number;
    totalCost: number;
  }> {
    console.log(`Fetching fuel records for mission ${missionId}...`);

    const records = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`))
      .orderBy(desc(fuelRecords.date), desc(fuelRecords.id));

    const [totals] = await db
      .select({
        totalQuantity: sql<string>`COALESCE(SUM(${fuelRecords.quantity}), 0)`,
        totalCost: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
      })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`));

    const creatorIds: number[] = Array.from(
      new Set(
        records
          .map((record: any) => record.createdBy)
          .filter(
            (candidate: unknown): candidate is number =>
              typeof candidate === "number" && Number.isFinite(candidate),
          ),
      ),
    );

    const creators =
      creatorIds.length > 0
        ? await db
            .select({
              id: users.id,
              name: users.name,
              role: users.role,
            })
            .from(users)
            .where(inArray(users.id, creatorIds))
        : [];

    const creatorById = new Map<number, { name: string; role: string }>();
    creators.forEach((creator) => {
      creatorById.set(creator.id, {
        name: creator.name,
        role: creator.role,
      });
    });

    const enrichedRecords = records.map((record: any) => {
      const creator =
        typeof record.createdBy === "number" ? creatorById.get(record.createdBy) : undefined;
      return {
        ...record,
        createdByName: creator?.name ?? null,
        createdByRole: creator?.role ?? null,
      };
    });

    return {
      records: enrichedRecords,
      totalQuantity: parseFloat(totals?.totalQuantity || "0"),
      totalCost: parseFloat(totals?.totalCost || "0"),
    };
  }

  async hasFuelRecordsForMission(missionId: number): Promise<boolean> {
    const [result] = await db
      .select({
        count: sql<string>`COUNT(*)`,
      })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`));

    return Number(result?.count || 0) > 0;
  }
  
  /**
   * Récupère l'historique carburant avec filtres
   */
  async getFuelHistory(filters: {
    year?: number;
    month?: number;
    vehicleId?: number;
    type?: 'credit' | 'debit' | 'all';
  } = {}) {
    console.log("Fetching fuel history with filters:", filters);
    
    let query: any = db.select().from(fuelRecords);
    
    const conditions: any[] = [];
    
    if (filters.year) {
      conditions.push(eq(fuelRecords.year, filters.year));
    }
    
    if (filters.month) {
      conditions.push(eq(fuelRecords.month, filters.month));
    }
    
    if (filters.vehicleId) {
      conditions.push(eq(fuelRecords.vehicleId, filters.vehicleId));
    }
    
    if (filters.type === 'credit') {
      conditions.push(sql`${fuelRecords.creditAmount} > 0`);
    } else if (filters.type === 'debit') {
      conditions.push(sql`${fuelRecords.debitAmount} > 0`);
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    const records = await query.orderBy(desc(fuelRecords.date));

    const creatorIds: number[] = Array.from(
      new Set(
        records
          .map((record: any) => record.createdBy)
          .filter((candidate: unknown): candidate is number => typeof candidate === "number" && Number.isFinite(candidate)),
      ),
    );

    const creators = creatorIds.length > 0
      ? await db
          .select({
            id: users.id,
            name: users.name,
            role: users.role,
          })
          .from(users)
          .where(inArray(users.id, creatorIds))
      : [];

    const creatorById = new Map<number, { name: string; role: string }>();
    creators.forEach((creator) => {
      creatorById.set(creator.id, {
        name: creator.name,
        role: creator.role,
      });
    });

    const enrichedRecords = records.map((record: any) => {
      const creator = typeof record.createdBy === "number"
        ? creatorById.get(record.createdBy)
        : undefined;
      const paymentMode =
        typeof record.paymentMode === "string" && record.paymentMode.trim().length > 0
          ? record.paymentMode
          : this.inferPaymentModeFromNotes(record.notes);
      return {
        ...record,
        paymentMode,
        createdByName: creator?.name ?? null,
        createdByRole: creator?.role ?? null,
      };
    });

    console.log(`Found ${enrichedRecords.length} fuel records`);
    return enrichedRecords;
  }
  
  /**
   * Statistiques de consommation par véhicule
   */
  async getConsumptionStatsByVehicle(vehicleId: number) {
    console.log(`Fetching consumption stats for vehicle ${vehicleId}...`);
    
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    
    if (!vehicle) {
      throw new Error(`Véhicule ${vehicleId} non trouvé`);
    }
    
    // Statistiques globales
    const [stats] = await db
      .select({
        totalLiters: sql<string>`COALESCE(SUM(${fuelRecords.quantity}), 0)`,
        totalCost: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        recordsCount: sql<string>`COUNT(*)`,
        avgQuantity: sql<string>`COALESCE(AVG(${fuelRecords.quantity}), 0)`,
        avgCost: sql<string>`COALESCE(AVG(${fuelRecords.debitAmount}), 0)`
      })
      .from(fuelRecords)
      .where(and(
        eq(fuelRecords.vehicleId, vehicleId),
        sql`${fuelRecords.debitAmount} > 0`
      ));
    
    const totalLiters = parseFloat(stats.totalLiters || "0");
    const totalCost = parseFloat(stats.totalCost || "0");
    const avgPricePerLiter = totalLiters > 0 ? totalCost / totalLiters : 0;
    
    // Stations principales
    const mainStations = await db
      .select({
        stationName: fuelRecords.stationName,
        count: sql<string>`COUNT(*)`
      })
      .from(fuelRecords)
      .where(and(
        eq(fuelRecords.vehicleId, vehicleId),
        sql`${fuelRecords.debitAmount} > 0`
      ))
      .groupBy(fuelRecords.stationName)
      .orderBy(desc(sql<string>`COUNT(*)`))
      .limit(5);
    
    const result = {
      vehicleId: vehicle.id,
      vehicleRegistration: vehicle.registrationNumber,
      totalLiters: totalLiters,
      totalCost: totalCost,
      recordsCount: Number(stats.recordsCount || 0),
      averageQuantity: parseFloat(stats.avgQuantity || "0"),
      averageCost: parseFloat(stats.avgCost || "0"),
      averagePricePerLiter: Math.round(avgPricePerLiter),
      mainStations: mainStations.map(s => ({
        name: s.stationName,
        count: Number(s.count)
      }))
    };
    
    console.log(`Stats for vehicle ${vehicleId}:`, result);
    return result;
  }
  
  /**
   * Détection d'anomalies de consommation
   */
  async detectAnomalies(vehicleId: number) {
    console.log(`Detecting consumption anomalies for vehicle ${vehicleId}...`);
    
    // Récupérer les consommations du véhicule
    const consumptions = await db
      .select()
      .from(fuelRecords)
      .where(and(
        eq(fuelRecords.vehicleId, vehicleId),
        sql`${fuelRecords.debitAmount} > 0`
      ))
      .orderBy(desc(fuelRecords.date));
    
    if (consumptions.length < 3) {
      return {
        hasAnomaly: false,
        averageConsumption: 0,
        threshold: 0,
        anomalies: []
      };
    }
    
    // Calculer moyenne et écart-type
    const quantities = consumptions.map(c => c.quantity);
    const avg = quantities.reduce((sum, q) => sum + q, 0) / quantities.length;
    const variance = quantities.reduce((sum, q) => sum + Math.pow(q - avg, 2), 0) / quantities.length;
    const stdDev = Math.sqrt(variance);
    
    // Détecter anomalies (> 2 écarts-types)
    const threshold = avg + (2 * stdDev);
    const anomalies = consumptions.filter(c => c.quantity > threshold);
    
    const result = {
      hasAnomaly: anomalies.length > 0,
      averageConsumption: Math.round(avg),
      threshold: Math.round(threshold),
      anomalies: anomalies.map(a => ({
        date: a.date,
        quantity: a.quantity,
        deviation: Math.round(((a.quantity - avg) / avg) * 100),
        stationName: a.stationName,
        cost: parseFloat(a.cost || "0")
      }))
    };
    
    console.log(`Anomalies detected: ${result.hasAnomaly ? 'YES' : 'NO'}, ${anomalies.length} anomalies found`);
    return result;
  }
  
  /**
   * Statistiques par client (MAERSK, CNPCC, etc.)
   */
  async getStatsByClient() {
    console.log("Fetching fuel stats by client...");
    
    const byClient = await db
      .select({
        clientName: fuelRecords.stationName,
        totalLiters: sql<string>`COALESCE(SUM(${fuelRecords.quantity}), 0)`,
        totalCost: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        recordsCount: sql<string>`COUNT(*)`
      })
      .from(fuelRecords)
      .where(sql`${fuelRecords.debitAmount} > 0`)
      .groupBy(fuelRecords.stationName)
      .orderBy(desc(sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`));
    
    const result = byClient.map(client => ({
      clientName: client.clientName || 'NON DÉFINI',
      totalLiters: parseFloat(client.totalLiters || "0"),
      totalCost: parseFloat(client.totalCost || "0"),
      recordsCount: Number(client.recordsCount || 0),
      averageCostPerRecord: parseFloat(client.totalCost || "0") / Number(client.recordsCount || 1)
    }));
    
    console.log(`Stats grouped by ${result.length} clients`);
    return result;
  }
  
  /**
   * Statistiques mensuelles multi-années
   */
  async getMonthlyStats(year: number, month: number) {
    console.log(`Fetching monthly stats for ${year}-${month}...`);
    
    const [stats] = await db
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${fuelRecords.creditAmount}), 0)`,
        totalDebits: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        totalLiters: sql<string>`COALESCE(SUM(CASE WHEN ${fuelRecords.debitAmount} > 0 THEN ${fuelRecords.quantity} ELSE 0 END), 0)`,
        creditsCount: sql<string>`COUNT(*) FILTER (WHERE ${fuelRecords.creditAmount} > 0)`,
        debitsCount: sql<string>`COUNT(*) FILTER (WHERE ${fuelRecords.debitAmount} > 0)`
      })
      .from(fuelRecords)
      .where(and(
        eq(fuelRecords.year, year),
        eq(fuelRecords.month, month)
      ));
    
    const result = {
      year,
      month,
      totalCredits: parseFloat(stats.totalCredits || "0"),
      totalDebits: parseFloat(stats.totalDebits || "0"),
      totalLiters: parseFloat(stats.totalLiters || "0"),
      balance: parseFloat(stats.totalCredits || "0") - parseFloat(stats.totalDebits || "0"),
      creditsCount: Number(stats.creditsCount || 0),
      debitsCount: Number(stats.debitsCount || 0)
    };
    
    console.log(`Monthly stats for ${year}-${month}:`, result);
    return result;
  }
}

export const fuelCardService = new FuelCardService();
