import { getFuelPriceAt } from "./fuel-price-service";
import { AppError } from "../lib/app-error";
import { lockFuelCard, type DbExecutor } from "../lib/fuel-card-lock";
import { moduleLogger } from "../lib/logger";
import { linkFuelConsumption, linkFuelRecharge } from "./treasury-links";
import { buildFuelConsumptionNotes } from "../lib/mission-fuel-regularization";
import { db } from "../db";
import { fuelRecords, users, vehicles, type FuelRecord } from "@shared/schema";
import { eq, desc, and, sql, gte, lte, isNull, inArray } from "drizzle-orm";

type FuelCardServiceErrorCode = "INSUFFICIENT_BALANCE" | "INVALID_INPUT" | "VEHICLE_NOT_FOUND";


const log = moduleLogger("fuel-card-service");

/**
 * Traduit une erreur du service en AppError lisible : 400 saisie invalide, 404 véhicule
 * inconnu, 409 solde insuffisant. Toute autre erreur devient une 500 générique (la cause
 * reste dans les logs, jamais dans la réponse).
 */
/** Message d'un plein refusé parce que sa clé de requête porte déjà un autre plein. */
export const FUEL_REQUEST_KEY_CONFLICT_MESSAGE =
  "Un autre plein a déjà été enregistré pour cette saisie. Rechargez la page pour voir les pleins enregistrés.";

/** Vrai si l'erreur (ou sa cause, le pilote étant parfois enveloppé) est l'index unique de la clé de requête. */
function isRequestKeyUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const { code, constraint, cause } = current as { code?: string; constraint?: string; cause?: unknown };
    if (code === "23505" && constraint === "ux_fuel_records_request_key") return true;
    current = cause;
  }
  return false;
}

export function toFuelCardAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isRequestKeyUniqueViolation(error)) return new AppError(409, FUEL_REQUEST_KEY_CONFLICT_MESSAGE, { cause: error });
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (code === "INVALID_INPUT") return new AppError(400, message, { cause: error });
  if (code === "VEHICLE_NOT_FOUND") return new AppError(404, "Véhicule introuvable.", { cause: error });
  if (code === "INSUFFICIENT_BALANCE") return new AppError(409, "Solde de la carte carburant insuffisant.", { cause: error });
  return new AppError(500, "Erreur serveur", { cause: error });
}

function isReadableDate(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(new Date(value).getTime());
}

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
  async getCurrentBalance(executor: DbExecutor = db) {
    log.debug("calcul du solde de la carte carburant");
    
    // Calculer totaux crédits et débits
    const [totals] = await executor
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${fuelRecords.creditAmount}), 0)`,
        totalDebits: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        totalLiters: sql<string>`COALESCE(SUM(CASE WHEN ${fuelRecords.debitAmount} > 0 THEN ${fuelRecords.quantity} ELSE 0 END), 0)`
      })
      .from(fuelRecords)
      .where(isNull(fuelRecords.deletedAt));
    
    const credits = parseFloat(totals.totalCredits || "0");
    const debits = parseFloat(totals.totalDebits || "0");
    const totalLiters = parseFloat(totals.totalLiters || "0");
    const balance = credits - debits;
    
    // Récupérer dernier crédit et dernier débit
    const [lastCredit] = await executor
      .select()
      .from(fuelRecords)
      .where(and(sql`${fuelRecords.creditAmount} > 0`, isNull(fuelRecords.deletedAt)))
      .orderBy(desc(fuelRecords.date))
      .limit(1);
    
    const [lastDebit] = await executor
      .select()
      .from(fuelRecords)
      .where(and(sql`${fuelRecords.debitAmount} > 0`, isNull(fuelRecords.deletedAt)))
      .orderBy(desc(fuelRecords.date))
      .limit(1);
    
    // Calculer solde en litres avec distinction explicite entre prix réel et fallback
    const fallbackPricePerLiter = await getFuelPriceAt();
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
    
    log.debug({ balance, fuelBalance: Math.round(fuelBalance) }, "solde de la carte carburant");
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
    /** Compte de trésorerie qui paie la recharge (lot T2) : la recharge devient un virement vers la carte. */
    sourceAccountId?: number | null;
  }) {
    log.info({ amount: data.amount, paymentMode: data.paymentMode, userId: data.userId }, "recharge de la carte carburant");

    if (!isReadableDate(data.date)) {
      throw this.createServiceError("Date de recharge illisible.", "INVALID_INPUT");
    }
    
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

    // Lecture du solde et écriture dans la même transaction, sous verrou :
    // l'instantané balance de la ligne reste juste face à un plein simultané.
    const { recharge, currentBalance, newBalance, newFuelBalance } = await db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const currentBalance = await this.getCurrentBalance(tx);
      const newBalance = currentBalance.balance + amount;
      const newFuelBalance = currentBalance.fuelBalance + quantity;

      // Créer l'enregistrement de recharge
      const [recharge] = await tx
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
      // Journal de trésorerie (lot T2) : sous le verrou carte déjà pris, annulé avec la recharge.
      await linkFuelRecharge(tx, recharge, data.userId, data.sourceAccountId);
      return { recharge, currentBalance, newBalance, newFuelBalance };
    });

    log.info({ amount, newBalance }, "carte carburant rechargée");
    
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
    /** Clé de requête de la soumission (index unique) : un second plein sous la même clé échoue en 409. */
    requestKey?: string;
  },
  /**
   * Écriture liée au débit (ex. journal de régularisation d'une mission), jouée dans la même
   * transaction, sous le verrou : si elle échoue, le débit est annulé avec elle.
   */
  withinTransaction?: (tx: DbExecutor, consumption: FuelRecord, cost: number) => Promise<void>,
  options?: {
    /**
     * Rejeu d'une écriture déjà faite (clé de requête), lu sous le verrou avant tout débit :
     * s'il renvoie un plein, aucun débit n'est écrit et ce plein est renvoyé (`replayed`).
     */
    replay?: (tx: DbExecutor) => Promise<FuelRecord | null>;
  },
  ) {
    log.info({ vehicleId: data.vehicleId, quantity: data.quantity, userId: data.userId }, "consommation de carburant");

    if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
      throw this.createServiceError("La quantité doit être un nombre positif.", "INVALID_INPUT");
    }
    if (!Number.isFinite(data.unitPrice) || data.unitPrice <= 0) {
      throw this.createServiceError("Le prix unitaire doit être un nombre positif.", "INVALID_INPUT");
    }
    if (!Number.isInteger(data.vehicleId) || data.vehicleId <= 0) {
      throw this.createServiceError("Identifiant de véhicule invalide.", "INVALID_INPUT");
    }
    if (!isReadableDate(data.date)) {
      throw this.createServiceError("Date de consommation illisible.", "INVALID_INPUT");
    }
    
    // Vérifier que le véhicule existe
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, data.vehicleId));
    
    if (!vehicle) {
      throw this.createServiceError(`Véhicule ${data.vehicleId} non trouvé`, "VEHICLE_NOT_FOUND");
    }
    
    // Calculer coût et nouveau solde
    const cost = data.quantity * data.unitPrice;

    const consumptionNotes = buildFuelConsumptionNotes(data);

    // Contrôle du solde et débit atomiques : deux pleins simultanés ne peuvent
    // plus lire le même solde et passer tous deux sous zéro.
    const { consumption, currentBalance, newBalance, replayed } = await db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const replayedRecord = options?.replay ? await options.replay(tx) : null;
      const currentBalance = await this.getCurrentBalance(tx);
      if (replayedRecord) {
        return { consumption: replayedRecord, currentBalance, newBalance: currentBalance.balance, replayed: true };
      }
    
      if (cost > currentBalance.balance) {
        throw this.createServiceError(
          `Solde insuffisant (${currentBalance.balance} FCFA < ${cost} FCFA)`,
          "INSUFFICIENT_BALANCE",
        );
      }
    
      const newBalance = currentBalance.balance - cost;
      const newFuelBalance = currentBalance.fuelBalance - data.quantity;

      // Créer l'enregistrement de consommation
      const [consumption] = await tx
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
          notes: consumptionNotes,
          year: new Date(data.date).getFullYear(),
          month: new Date(data.date).getMonth() + 1,
          createdBy: data.userId,
          requestKey: data.requestKey ?? null,
        })
        .returning();
      // Journal de trésorerie (lot T2) : sortie de la carte, sous le même verrou, annulée avec le plein.
      await linkFuelConsumption(tx, consumption, data.userId);
      if (withinTransaction) await withinTransaction(tx, consumption, cost);
      return { consumption, currentBalance, newBalance, replayed: false };
    });

    if (replayed) {
      log.info({ vehicleId: data.vehicleId, fuelRecordId: consumption.id }, "consommation déjà enregistrée, rejouée sans débit");
      return {
        consumption,
        previousBalance: currentBalance.balance,
        newBalance,
        cost: Number(consumption.debitAmount ?? 0),
        replayed,
      };
    }

    log.info({ vehicleId: data.vehicleId, cost, newBalance }, "consommation de carburant enregistrée");
    
    return {
      consumption,
      previousBalance: currentBalance.balance,
      newBalance: newBalance,
      cost: cost,
      replayed,
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
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`, isNull(fuelRecords.deletedAt)))
      .orderBy(desc(fuelRecords.date), desc(fuelRecords.id));

    const [totals] = await db
      .select({
        totalQuantity: sql<string>`COALESCE(SUM(${fuelRecords.quantity}), 0)`,
        totalCost: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
      })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`, isNull(fuelRecords.deletedAt)));

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

  async hasFuelRecordsForMission(missionId: number, executor: DbExecutor = db): Promise<boolean> {
    const [result] = await executor
      .select({
        count: sql<string>`COUNT(*)`,
      })
      .from(fuelRecords)
      .where(and(eq(fuelRecords.missionId, missionId), sql`${fuelRecords.debitAmount} > 0`, isNull(fuelRecords.deletedAt)));

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
    
    const conditions: any[] = [isNull(fuelRecords.deletedAt)];
    
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
      throw this.createServiceError(`Véhicule ${vehicleId} non trouvé`, "VEHICLE_NOT_FOUND");
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
        sql`${fuelRecords.debitAmount} > 0`,
        isNull(fuelRecords.deletedAt)
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
        sql`${fuelRecords.debitAmount} > 0`,
        isNull(fuelRecords.deletedAt)
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
        sql`${fuelRecords.debitAmount} > 0`,
        isNull(fuelRecords.deletedAt)
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
  async getStatsByClient(ownerId: number | null = null) {
    console.log("Fetching fuel stats by client...");

    // Cloison client (AGENTS §11) : `ownerId` non nul = ne compter que les pleins des véhicules
    // de ce propriétaire (`vehicles.ownerId`). `null` = personnel, aucun filtre.
    const ownerFilter = ownerId === null
      ? sql`TRUE`
      : sql`${fuelRecords.vehicleId} IN (SELECT ${vehicles.id} FROM ${vehicles} WHERE ${vehicles.ownerId} = ${ownerId})`;

    const byClient = await db
      .select({
        clientName: fuelRecords.stationName,
        totalLiters: sql<string>`COALESCE(SUM(${fuelRecords.quantity}), 0)`,
        totalCost: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
        recordsCount: sql<string>`COUNT(*)`
      })
      .from(fuelRecords)
      .where(sql`${fuelRecords.debitAmount} > 0 AND ${fuelRecords.deletedAt} IS NULL AND ${ownerFilter}`)
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
        eq(fuelRecords.month, month),
        isNull(fuelRecords.deletedAt)
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
