import { db } from "../db";
import { parts, partsStockMovements, partRequirements, suppliers, workOrders, type Part } from "@shared/schema";
import { eq, sql, desc, sum, count, gte, lte } from "drizzle-orm";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("stock-alerts-service");
/** Borne de la colonne `integer` : au-delà, Postgres lèverait une erreur rendue en 500. */
const MAX_STOCK = 2147483647;

/**
 * Service Stock & Alertes
 *
 * Responsabilités :
 * - Gestion valeur inventaire (94,4M FCFA de pièces)
 * - Alertes CDE automatiques (38 alertes actives)
 * - Calcul stock réel temps réel
 * - Statistiques et analyses magasin
 */
export class StockAlertsService {

  /**
   * Récupère la valeur totale de l'inventaire
   * Exploite les 58 pièces importées (94 366 959 FCFA)
   */
  async getInventoryValue() {
    log.debug("Calculating inventory value from 58 imported parts...");

    const [stats] = await db
      .select({
        totalValue: sql<string>`COALESCE(SUM(${parts.quantity} * ${parts.unitPrice}::numeric), 0)`,
        totalParts: count(parts.id),
        totalQuantity: sum(parts.quantity)
      })
      .from(parts);

    // Calcul par catégorie
    const byCategory = await db
      .select({
        category: parts.category,
        count: count(parts.id),
        value: sql<string>`COALESCE(SUM(${parts.quantity} * ${parts.unitPrice}::numeric), 0)`,
        totalQuantity: sum(parts.quantity)
      })
      .from(parts)
      .groupBy(parts.category);

    const result = {
      totalValue: parseFloat(stats.totalValue || "0"),
      totalParts: Number(stats.totalParts || 0),
      totalQuantity: Number(stats.totalQuantity || 0),
      byCategory: byCategory.reduce((acc, cat) => {
        acc[cat.category || 'NON_CATEGORISE'] = {
          count: Number(cat.count),
          value: parseFloat(cat.value || "0"),
          quantity: Number(cat.totalQuantity || 0)
        };
        return acc;
      }, {} as Record<string, { count: number; value: number; quantity: number }>)
    };

    log.debug({ result }, "Inventory value calculated");
    return result;
  }

  /**
   * Récupère les alertes de réapprovisionnement actives
   * Source de vérité: stock actuel <= seuil min (pas uniquement le flag reorderAlert)
   */
  async getReorderAlerts() {
    log.debug("Fetching reorder alerts (low stock parts)...");

    const alerts = await db
      .select({
        id: parts.id,
        name: parts.name,
        reference: parts.reference,
        category: parts.category,
        quantity: parts.quantity,
        realStock: parts.realStock,
        minQuantity: parts.minQuantity,
        unitPrice: parts.unitPrice,
        supplier: parts.supplier,
        reorderAlert: parts.reorderAlert,
        shortage: sql<number>`${parts.minQuantity} - ${parts.quantity}`
      })
      .from(parts)
      .where(lte(parts.quantity, parts.minQuantity))
      .orderBy(sql`${parts.minQuantity} - ${parts.quantity} DESC`);

    // Calculer le coût estimé de réapprovisionnement
    const totalShortage = alerts.reduce((sum, alert) => {
      const shortage = Math.max(0, Number(alert.shortage));
      return sum + shortage;
    }, 0);

    const estimatedCost = alerts.reduce((sum, alert) => {
      const shortage = Math.max(0, Number(alert.shortage));
      const unitPrice = parseFloat(alert.unitPrice || "0");
      return sum + (shortage * unitPrice);
    }, 0);

    const result = {
      parts: alerts.map(alert => ({
        ...alert,
        unitPrice: parseFloat(alert.unitPrice || "0"),
        shortage: Math.max(0, Number(alert.shortage))
      })),
      totalAlerts: alerts.length,
      totalShortage: totalShortage,
      estimatedCost: estimatedCost
    };

    log.debug(`Found ${alerts.length} reorder alerts, estimated cost: ${estimatedCost} FCFA`);
    return result;
  }

  /**
   * Calcule le stock réel d'une pièce
   * Utilise realStock + mouvements pour cohérence
   */
  async getRealStock(partId: number) {
    log.debug(`Calculating real stock for part ${partId}...`);

    const [part] = await db
      .select()
      .from(parts)
      .where(eq(parts.id, partId));

    if (!part) {
      throw new AppError(404, "Pièce introuvable.");
    }

    // Récupérer les mouvements récents
    const movements = await db
      .select()
      .from(partsStockMovements)
      .where(eq(partsStockMovements.partId, partId))
      .orderBy(desc(partsStockMovements.createdAt))
      .limit(10);

    const result = {
      partId: part.id,
      name: part.name,
      reference: part.reference,
      quantity: part.quantity,
      realStock: part.realStock || part.quantity,
      minQuantity: part.minQuantity,
      reorderAlert: part.reorderAlert,
      movements: movements.map(m => ({
        id: m.id,
        type: m.movementType,
        quantity: m.quantity,
        previousStock: m.previousStock,
        newStock: m.newStock,
        reason: m.reason,
        date: m.createdAt
      }))
    };

    log.debug(`Real stock for part ${partId}: ${result.realStock}`);
    return result;
  }

  /**
   * Enregistre un mouvement de stock (ENTRÉE/SORTIE)
   */
  async recordStockMovement(data: {
    partId: number;
    type: 'in' | 'out';
    quantity: number;
    reason: string;
    workOrderId?: number;
    responsiblePerson?: string;
    deliveryReceiptNumber?: string;
    userId: number;
  }) {
    log.debug({ partId: data.partId, type: data.type, quantity: data.quantity, workOrderId: data.workOrderId, userId: data.userId }, "Enregistrement d'un mouvement de stock");

    if (!Number.isInteger(data.quantity) || data.quantity <= 0 || data.quantity > MAX_STOCK) {
      throw new AppError(400, "La quantité doit être un entier strictement positif.");
    }

    if (data.workOrderId !== undefined) {
      const [wo] = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.id, data.workOrderId));
      if (!wo) {
        throw new AppError(404, "Ordre de travail introuvable.");
      }
    }

    // Lecture puis écriture dans une seule transaction, ligne verrouillée :
    // deux sorties concurrentes ne peuvent plus lire le même stock initial.
    const result = await db.transaction(async (tx) => {
      const [part] = await tx
        .select()
        .from(parts)
        .where(eq(parts.id, data.partId))
        .for("update");

      if (!part) {
        throw new AppError(404, "Pièce introuvable.");
      }

      const previousStock = part.quantity;
      if (data.type === 'out' && data.quantity > previousStock) {
        throw new AppError(
          409,
          `Sortie impossible : ${previousStock} unité(s) en stock, ${data.quantity} demandée(s).`,
        );
      }
      const newStock = data.type === 'in' ? previousStock + data.quantity : previousStock - data.quantity;
      if (newStock > MAX_STOCK) {
        throw new AppError(400, "Entrée impossible : le stock dépasserait la capacité enregistrable.");
      }

      const [movement] = await tx
        .insert(partsStockMovements)
        .values({
          partId: data.partId,
          movementType: data.type,
          quantity: data.quantity,
          previousStock,
          newStock,
          reason: data.reason,
          workOrderId: data.workOrderId,
          createdBy: data.userId,
          createdAt: new Date()
        })
        .returning();

      const shouldReorder = newStock <= part.minQuantity;

      await tx
        .update(parts)
        .set({
          quantity: newStock,
          realStock: newStock,
          reorderAlert: shouldReorder,
          responsiblePerson: data.responsiblePerson || part.responsiblePerson,
          deliveryReceiptNumber: data.deliveryReceiptNumber || part.deliveryReceiptNumber,
          updatedBy: data.userId,
          updatedAt: new Date()
        })
        .where(eq(parts.id, data.partId));

      return { movement, previousStock, newStock, reorderAlert: shouldReorder };
    });

    log.debug(
      { partId: data.partId, previousStock: result.previousStock, newStock: result.newStock, reorderAlert: result.reorderAlert },
      "mouvement de stock enregistré",
    );

    return result;
  }

  /**
   * Récupère les pièces les plus utilisées
   * Basé sur les mouvements de type 'out'
   */
  async getMostUsedParts(limit: number = 10) {
    log.debug(`Fetching top ${limit} most used parts...`);

    const mostUsed = await db
      .select({
        partId: partsStockMovements.partId,
        partName: parts.name,
        partReference: parts.reference,
        category: parts.category,
        totalUsed: sum(partsStockMovements.quantity),
        usageCount: count(partsStockMovements.id),
        unitPrice: parts.unitPrice,
        currentStock: parts.quantity
      })
      .from(partsStockMovements)
      .innerJoin(parts, eq(partsStockMovements.partId, parts.id))
      .where(eq(partsStockMovements.movementType, 'out'))
      .groupBy(partsStockMovements.partId, parts.name, parts.reference, parts.category, parts.unitPrice, parts.quantity)
      .orderBy(desc(sum(partsStockMovements.quantity)))
      .limit(limit);

    const result = mostUsed.map(part => ({
      partId: part.partId,
      name: part.partName,
      reference: part.partReference,
      category: part.category,
      totalUsed: Number(part.totalUsed || 0),
      usageCount: Number(part.usageCount || 0),
      unitPrice: parseFloat(part.unitPrice || "0"),
      currentStock: part.currentStock,
      totalValue: Number(part.totalUsed || 0) * parseFloat(part.unitPrice || "0")
    }));

    log.debug(`Found ${result.length} most used parts`);
    return result;
  }

  /**
   * Récupère les statistiques globales du magasin
   */
  async getWarehouseStatistics() {
    log.debug("Calculating warehouse statistics...");

    const inventoryValue = await this.getInventoryValue();
    const reorderAlerts = await this.getReorderAlerts();

    // Statistiques mouvements
    const [movementStats] = await db
      .select({
        totalMovements: count(partsStockMovements.id),
        totalIn: sql<string>`COALESCE(SUM(CASE WHEN ${partsStockMovements.movementType} = 'in' THEN ${partsStockMovements.quantity} ELSE 0 END), 0)`,
        totalOut: sql<string>`COALESCE(SUM(CASE WHEN ${partsStockMovements.movementType} = 'out' THEN ${partsStockMovements.quantity} ELSE 0 END), 0)`
      })
      .from(partsStockMovements);

    // Pièces par catégorie
    const categoriesCount = await db
      .select({
        category: parts.category,
        count: count(parts.id)
      })
      .from(parts)
      .groupBy(parts.category);

    // Sorties exceptionnelles: pièces parties sans passer par le magasin.
    // C'est un indicateur de gouvernance, pas de stock: si le chiffre s'emballe,
    // la réponse est une astreinte magasin, pas une règle logicielle de plus.
    // La note posée par le service sert de marqueur — une demande n'étant sortie
    // qu'une fois (`issued` est final), compter les lignes suffit.
    const trenteJours = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [exceptionalStats] = await db
      .select({
        total: count(partRequirements.id),
        last30Days: sql<string>`COALESCE(SUM(CASE WHEN ${partRequirements.updatedAt} >= ${trenteJours} THEN 1 ELSE 0 END), 0)`,
      })
      .from(partRequirements)
      .where(sql`${partRequirements.notes} LIKE '%[SORTIE EXCEPTIONNELLE%'`);

    const result = {
      inventoryValue: inventoryValue.totalValue,
      totalParts: inventoryValue.totalParts,
      totalQuantity: inventoryValue.totalQuantity,
      reorderAlerts: reorderAlerts.totalAlerts,
      estimatedReorderCost: reorderAlerts.estimatedCost,
      categories: categoriesCount.reduce((acc, cat) => {
        acc[cat.category || 'NON_CATEGORISE'] = Number(cat.count);
        return acc;
      }, {} as Record<string, number>),
      movements: {
        total: Number(movementStats.totalMovements || 0),
        totalIn: Number(movementStats.totalIn || 0),
        totalOut: Number(movementStats.totalOut || 0),
        balance: Number(movementStats.totalIn || 0) - Number(movementStats.totalOut || 0)
      },
      exceptionalIssues: {
        total: Number(exceptionalStats?.total || 0),
        last30Days: Number(exceptionalStats?.last30Days || 0)
      }
    };

    log.debug({ result }, "Warehouse statistics calculated");
    return result;
  }

  /**
   * Récupère les pièces par fournisseur avec valeur totale
   */
  async getPartsBySupplier() {
    log.debug("Fetching parts by supplier...");

    // Regroupement sur `supplier_id` (clé étrangère), plus sur le nom en clair:
    // la saisie libre historique produisait des doublons ("CFAO Mobility" vs
    // "CFAO  MOBILITY" comptaient comme deux fournisseurs distincts).
    // Les pièces pas encore rattachées retombent sur leur nom textuel, signalées
    // par `isLinked: false` pour qu'on puisse les traiter.
    const bySupplier = await db
      .select({
        supplierId: parts.supplierId,
        supplierName: suppliers.name,
        legacySupplier: parts.supplier,
        count: count(parts.id),
        totalQuantity: sum(parts.quantity),
        totalValue: sql<string>`COALESCE(SUM(${parts.quantity} * ${parts.unitPrice}::numeric), 0)`
      })
      .from(parts)
      .leftJoin(suppliers, eq(parts.supplierId, suppliers.id))
      .groupBy(parts.supplierId, suppliers.name, parts.supplier)
      .orderBy(desc(sql<string>`COALESCE(SUM(${parts.quantity} * ${parts.unitPrice}::numeric), 0)`));

    const result = bySupplier.map(sup => ({
      supplierId: sup.supplierId ?? null,
      supplier: sup.supplierName || sup.legacySupplier || 'NON DÉFINI',
      isLinked: sup.supplierId !== null,
      partsCount: Number(sup.count || 0),
      totalQuantity: Number(sup.totalQuantity || 0),
      totalValue: parseFloat(sup.totalValue || "0")
    }));

    log.debug(`Parts grouped by ${result.length} suppliers`);
    return result;
  }

  /**
   * Récupère les pièces les plus consommées pour le graphique
   * Format adapté pour le graphique de consommation
   */
  async getTopConsumedParts(limit: number = 10) {
    log.debug(`Fetching top ${limit} consumed parts for chart...`);

    const consumed = await db
      .select({
        partId: partsStockMovements.partId,
        partName: parts.name,
        totalQuantity: sum(partsStockMovements.quantity),
        unitPrice: parts.unitPrice,
      })
      .from(partsStockMovements)
      .innerJoin(parts, eq(partsStockMovements.partId, parts.id))
      .where(eq(partsStockMovements.movementType, 'out'))
      .groupBy(partsStockMovements.partId, parts.name, parts.unitPrice)
      .orderBy(desc(sum(partsStockMovements.quantity)))
      .limit(limit);

    const result = consumed.map(part => ({
      partName: part.partName,
      quantity: Number(part.totalQuantity || 0),
      totalValue: Number(part.totalQuantity || 0) * parseFloat(part.unitPrice || "0")
    }));

    log.debug(`Found ${result.length} top consumed parts`);
    return result;
  }

  /**
   * Génère l'historique de valeur du stock
   * Basé uniquement sur les mouvements réels (aucune simulation)
   */
  async getStockValueHistory(days: number = 30) {
    const safeDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30;
    log.debug(`Generating stock value history for last ${safeDays} days (real data only)...`);

    const currentInventory = await this.getInventoryValue();
    const currentValue = Number(currentInventory.totalValue || 0);
    const currentItemCount = Number(currentInventory.totalParts || 0);
    const toDateKey = (value: Date): string => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const normalizeDateKey = (raw: unknown): string | null => {
      if (raw instanceof Date) {
        return toDateKey(raw);
      }
      if (typeof raw === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          return raw;
        }
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          return toDateKey(parsed);
        }
      }
      return null;
    };

    const lowerBound = new Date();
    lowerBound.setHours(0, 0, 0, 0);
    lowerBound.setDate(lowerBound.getDate() - (safeDays - 1));

    // Delta de valeur par jour, calculé depuis les variations réelles de stock
    const dailyValueDeltas = await db
      .select({
        date: sql<string>`DATE(${partsStockMovements.createdAt})`,
        deltaValue: sql<string>`COALESCE(SUM((${partsStockMovements.newStock} - ${partsStockMovements.previousStock}) * COALESCE(${parts.unitPrice}::numeric, 0)), 0)`,
      })
      .from(partsStockMovements)
      .innerJoin(parts, eq(partsStockMovements.partId, parts.id))
      .where(gte(partsStockMovements.createdAt, lowerBound))
      .groupBy(sql`DATE(${partsStockMovements.createdAt})`)
      .orderBy(desc(sql`DATE(${partsStockMovements.createdAt})`));

    const deltasByDate = new Map<string, number>();
    dailyValueDeltas.forEach((row) => {
      const dateKey = normalizeDateKey(row.date);
      if (!dateKey) return;
      deltasByDate.set(dateKey, Number(row.deltaValue || 0));
    });

    const history: StockValueHistory[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let runningValue = currentValue;

    for (let i = 0; i < safeDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = toDateKey(date);

      // Valeur de fin de journée pour la date courante
      history.push({
        date: dateStr,
        totalValue: Math.max(0, Number(runningValue.toFixed(2))),
        itemCount: currentItemCount,
      });

      // Pour remonter au jour précédent, on retire le delta de la journée courante
      const dayDelta = deltasByDate.get(dateStr) || 0;
      runningValue -= dayDelta;
    }

    history.reverse();

    log.debug(`Generated ${history.length} days of stock value history`);
    return history;
  }
}

export const stockAlertsService = new StockAlertsService();

interface PartsBySupplier {
  supplier: string;
  partsCount: number;
  totalValue: number;
  categories: string[];
}

interface TopConsumedPart {
  partName: string;
  quantity: number;
  totalValue: number;
}

interface StockValueHistory {
  date: string;
  totalValue: number;
  itemCount: number;
}
