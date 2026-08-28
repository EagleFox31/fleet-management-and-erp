import { db } from "../db";
import { parts, partsStockMovements, users, workOrders, type Part, type InsertPart } from "@shared/schema";
import { eq, desc, asc, sql, and, lte, gte, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const createdByUser = alias(users, "parts_created_by_user");
const updatedByUser = alias(users, "parts_updated_by_user");

export class PartsService {
  // Récupérer toutes les pièces avec pagination
  async getParts(
    page: number = 1,
    limit: number = 20,
    search?: string,
    sortBy?: string,
    sortOrder: "asc" | "desc" = "asc",
  ) {
    console.log("getParts called - fetching from PostgreSQL...");

    const conditions: SQL[] = [];
    if (search) {
      conditions.push(
        sql`${parts.name} ILIKE ${`%${search}%`} OR ${parts.reference} ILIKE ${`%${search}%`}`,
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sortColumnMap = {
      reference: parts.reference,
      name: parts.name,
      quantity: parts.quantity,
      unitPrice: parts.unitPrice,
      location: parts.location,
      supplier: parts.supplier,
    } as const;

    const sortColumn =
      sortBy && sortBy in sortColumnMap
        ? sortColumnMap[sortBy as keyof typeof sortColumnMap]
        : parts.reference;
    const orderByClause = sortOrder === "desc" ? desc(sortColumn) : asc(sortColumn);

    const offset = (page - 1) * limit;
    const partsQuery = db.select().from(parts);
    const partsData = await (whereClause ? partsQuery.where(whereClause) : partsQuery)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const creatorIds: number[] = Array.from(
      new Set(
        partsData
          .flatMap((part: any) => [Number(part.createdBy), Number(part.updatedBy)])
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
    const userNameById = new Map<number, string>();

    if (creatorIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, creatorIds));

      for (const user of userRows) {
        userNameById.set(user.id, user.name);
      }
    }

    const partsWithCreator = partsData.map((part: any) => ({
      ...part,
      createdByName:
        typeof part.createdBy === "number" ? userNameById.get(part.createdBy) ?? null : null,
      updatedByName:
        typeof part.updatedBy === "number" ? userNameById.get(part.updatedBy) ?? null : null,
    }));

    // Compter le total
    const countQuery = db.select({ count: sql<number>`count(*)` }).from(parts);
    const [{ count }] = await (whereClause ? countQuery.where(whereClause) : countQuery);

    console.log(`Parts retrieved from DB: ${partsData.length} items, total: ${count}`);
    
    return {
      parts: partsWithCreator,
      total: parseInt(count.toString())
    };
  }

  // Récupérer une pièce par ID
  async getPartById(id: number): Promise<Part | undefined> {
    const [result] = await db
      .select({
        part: parts,
        createdByName: createdByUser.name,
        updatedByName: updatedByUser.name,
      })
      .from(parts)
      .leftJoin(createdByUser, eq(parts.createdBy, createdByUser.id))
      .leftJoin(updatedByUser, eq(parts.updatedBy, updatedByUser.id))
      .where(eq(parts.id, id));

    if (!result) {
      return undefined;
    }

    return {
      ...result.part,
      createdByName: result.createdByName,
      updatedByName: result.updatedByName,
    } as Part;
  }

  // Créer une nouvelle pièce
  async createPart(insertPart: InsertPart, createdBy?: number): Promise<Part> {
    console.log("Creating new part:", insertPart);
    
    // Validation des données
    if (!insertPart.name || !insertPart.reference) {
      throw new Error("Le nom et la référence sont obligatoires");
    }

    // Vérifier l'unicité de la référence
    const existingPart = await db
      .select()
      .from(parts)
      .where(eq(parts.reference, insertPart.reference))
      .limit(1);

    if (existingPart.length > 0) {
      throw new Error("Une pièce avec cette référence existe déjà");
    }

    const normalizedQuantity = insertPart.quantity ?? 0;
    const normalizedMinQuantity = insertPart.minQuantity ?? 5;
    const shouldReorder = normalizedQuantity <= normalizedMinQuantity;

    // Créer la pièce avec cohérence stock réel / alerte réappro
    const now = new Date();
    const [newPart] = await db
      .insert(parts)
      .values({
        ...insertPart,
        quantity: normalizedQuantity,
        minQuantity: normalizedMinQuantity,
        realStock: normalizedQuantity,
        reorderAlert: shouldReorder,
        unit: insertPart.unit || "pièce",
        unitPrice: insertPart.unitPrice || "0",
        createdBy: createdBy ?? null,
        updatedBy: createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Créer un mouvement de stock initial si quantity > 0
    if (newPart.quantity > 0) {
      await this.createStockMovement({
        partId: newPart.id,
        movementType: "initial",
        quantity: newPart.quantity,
        previousStock: 0,
        newStock: newPart.quantity,
        reason: "Stock initial",
        createdBy
      });
    }

    console.log("Part created successfully:", newPart);
    return newPart;
  }

  // Mettre à jour une pièce
  async updatePart(
    id: number,
    updateData: Partial<InsertPart>,
    updatedBy?: number,
  ): Promise<Part> {
    console.log(`Updating part ${id}:`, updateData);

    // Vérifier que la pièce existe
    const existingPart = await this.getPartById(id);
    if (!existingPart) {
      throw new Error("Pièce non trouvée");
    }

    // Si la référence est modifiée, vérifier l'unicité
    if (updateData.reference && updateData.reference !== existingPart.reference) {
      const duplicatePart = await db
        .select()
        .from(parts)
        .where(and(
          eq(parts.reference, updateData.reference),
          sql`${parts.id} != ${id}`
        ))
        .limit(1);

      if (duplicatePart.length > 0) {
        throw new Error("Une pièce avec cette référence existe déjà");
      }
    }

    const [updatedPart] = await db
      .update(parts)
      .set({
        ...updateData,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(parts.id, id))
      .returning();

    console.log("Part updated successfully:", updatedPart);
    return updatedPart;
  }

  // Supprimer une pièce
  async deletePart(id: number): Promise<void> {
    console.log(`Deleting part ${id}`);

    // Vérifier que la pièce existe
    const existingPart = await this.getPartById(id);
    if (!existingPart) {
      throw new Error("Pièce non trouvée");
    }

    // Supprimer les mouvements de stock associés
    await db.delete(partsStockMovements).where(eq(partsStockMovements.partId, id));

    // Supprimer la pièce
    await db.delete(parts).where(eq(parts.id, id));

    console.log("Part deleted successfully");
  }

  // Mettre à jour le stock d'une pièce
  async updateStock(id: number, adjustment: number, reason: string, userId?: number): Promise<Part> {
    console.log(`Updating stock for part ${id}: adjustment=${adjustment}, reason=${reason}`);

    const part = await this.getPartById(id);
    if (!part) {
      throw new Error("Pièce non trouvée");
    }

    const newStock = Math.max(0, part.quantity + adjustment);
    const movementType = adjustment > 0 ? "in" : "out";

    // Mettre à jour le stock
    const [updatedPart] = await db
      .update(parts)
      .set({
        quantity: newStock,
        updatedBy: userId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(parts.id, id))
      .returning();

    // Créer un mouvement de stock
    await this.createStockMovement({
      partId: id,
      movementType: adjustment > 0 ? "in" : "out",
      quantity: Math.abs(adjustment),
      previousStock: part.quantity,
      newStock: newStock,
      reason: reason,
      createdBy: userId
    });

    console.log("Stock updated successfully:", updatedPart);
    return updatedPart;
  }

  // Créer un mouvement de stock
  async createStockMovement(movement: {
    partId: number;
    movementType: "in" | "out" | "adjustment" | "initial";
    quantity: number;
    previousStock: number;
    newStock: number;
    reason: string;
    notes?: string;
    workOrderId?: number;
    createdBy?: number;
  }) {
    console.log("Creating stock movement:", movement);

    const [newMovement] = await db
      .insert(partsStockMovements)
      .values({
        partId: movement.partId,
        movementType: movement.movementType,
        quantity: movement.quantity,
        previousStock: movement.previousStock,
        newStock: movement.newStock,
        reason: movement.reason,
        notes: movement.notes,
        workOrderId: movement.workOrderId,
        createdBy: movement.createdBy,
        createdAt: new Date()
      })
      .returning();

    console.log("Stock movement created:", newMovement);
    return newMovement;
  }

  // Récupérer l'historique des mouvements de stock pour une pièce
  async getStockHistory(partId: number) {
    console.log(`Getting stock history for part ${partId}`);

    const movements = await db
      .select({
        id: partsStockMovements.id,
        movementType: partsStockMovements.movementType,
        quantity: partsStockMovements.quantity,
        previousStock: partsStockMovements.previousStock,
        newStock: partsStockMovements.newStock,
        reason: partsStockMovements.reason,
        notes: partsStockMovements.notes,
        workOrderId: partsStockMovements.workOrderId,
        createdBy: partsStockMovements.createdBy,
        createdAt: partsStockMovements.createdAt,
        createdByName: users.name
      })
      .from(partsStockMovements)
      .leftJoin(users, eq(partsStockMovements.createdBy, users.id))
      .where(eq(partsStockMovements.partId, partId))
      .orderBy(desc(partsStockMovements.createdAt));

    // Enrichir avec les titres des ordres de travail
    const enrichedMovements = await Promise.all(
      movements.map(async (movement) => {
        if (movement.workOrderId) {
          const [workOrder] = await db
            .select({ title: workOrders.title })
            .from(workOrders)
            .where(eq(workOrders.id, movement.workOrderId));
          
          return {
            ...movement,
            workOrderTitle: workOrder?.title || "Ordre supprimé"
          };
        }
        return movement;
      })
    );

    console.log(`Retrieved ${enrichedMovements.length} movements for part ${partId}`);
    return enrichedMovements;
  }

  // Récupérer les pièces en stock bas
  async getLowStockParts(): Promise<Part[]> {
    console.log("getLowStockParts called - using fixed methods");
    
    const lowStockParts = await db
      .select()
      .from(parts)
      .where(sql`${parts.quantity} <= ${parts.minQuantity}`)
      .orderBy(desc(parts.quantity));

    console.log(`Found ${lowStockParts.length} parts with low stock`);
    return lowStockParts;
  }

  // Calculer les statistiques des pièces
  async getPartsStatistics() {
    console.log("Calculating parts statistics");

    const [stats] = await db
      .select({
        // `totalItems` est la SOMME DES QUANTITÉS, pas un nombre de fiches.
        // Nom historique et trompeur, conservé pour compatibilité: préférer
        // `totalQuantity` (unités physiques) et `totalParts` (références).
        totalItems: sql<string>`sum(${parts.quantity})`,
        totalQuantity: sql<string>`sum(${parts.quantity})`,
        totalParts: sql<string>`count(${parts.id})`,
        totalValue: sql<string>`sum(${parts.quantity} * ${parts.unitPrice}::numeric)`,
        lowStockCount: sql<string>`count(*) filter (where ${parts.quantity} > 0 and ${parts.quantity} <= ${parts.minQuantity})`,
        outOfStockCount: sql<string>`count(*) filter (where ${parts.quantity} <= 0)`
      })
      .from(parts);

    const result = {
      totalItems: stats.totalItems || "0",
      // Unités physiques en stock (somme des quantités).
      totalQuantity: stats.totalQuantity || "0",
      // Nombre de références distinctes au catalogue.
      totalParts: stats.totalParts || "0",
      totalValue: Math.round(parseFloat(stats.totalValue || "0")).toString(),
      lowStockCount: stats.lowStockCount || "0",
      outOfStockCount: stats.outOfStockCount || "0"
    };

    console.log("Parts statistics calculated:", result);
    return result;
  }

  // Récupérer les ordres de travail utilisant une pièce
  async getWorkOrdersForPart(partId: number) {
    console.log(`Getting work orders for part ${partId}`);

    // Récupérer depuis parts_stock_movements
    const workOrdersFromMovements = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        status: workOrders.status,
        vehicleRegistration: workOrders.vehicleRegistration,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate
      })
      .from(workOrders)
      .innerJoin(partsStockMovements, eq(partsStockMovements.workOrderId, workOrders.id))
      .where(eq(partsStockMovements.partId, partId))
      .orderBy(desc(workOrders.startDate));

    // Récupérer aussi depuis parts_used pour compatibilité avec les anciennes données
    const { partsUsed } = await import("@shared/schema");
    const workOrdersFromPartsUsed = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        status: workOrders.status,
        vehicleRegistration: workOrders.vehicleRegistration,
        startDate: workOrders.startDate,
        endDate: workOrders.endDate
      })
      .from(workOrders)
      .innerJoin(partsUsed, eq(partsUsed.workOrderId, workOrders.id))
      .where(eq(partsUsed.partId, partId))
      .orderBy(desc(workOrders.startDate));

    // Fusionner et dédupliquer les résultats
    const allWorkOrders = [...workOrdersFromMovements, ...workOrdersFromPartsUsed];
    const uniqueWorkOrders = allWorkOrders.filter((wo, index, self) => 
      index === self.findIndex(t => t.id === wo.id)
    );

    console.log(`Found ${uniqueWorkOrders.length} work orders for part ${partId} (${workOrdersFromMovements.length} from movements, ${workOrdersFromPartsUsed.length} from parts_used)`);
    return uniqueWorkOrders.sort((a, b) => {
      const bTime = b.startDate ? new Date(b.startDate).getTime() : 0;
      const aTime = a.startDate ? new Date(a.startDate).getTime() : 0;
      return bTime - aTime;
    });
  }

  // Récupérer l'historique d'utilisation d'une pièce
  async getUsageHistory(partId: number) {
    console.log(`Getting usage history for part ${partId}`);

    // Récupérer depuis parts_stock_movements
    const usageFromMovements = await db
      .select({
        id: partsStockMovements.id,
        workOrderId: partsStockMovements.workOrderId,
        workOrderTitle: workOrders.title,
        quantity: partsStockMovements.quantity,
        date: partsStockMovements.createdAt,
        vehicleRegistration: workOrders.vehicleRegistration
      })
      .from(partsStockMovements)
      .leftJoin(workOrders, eq(partsStockMovements.workOrderId, workOrders.id))
      .where(and(
        eq(partsStockMovements.partId, partId),
        eq(partsStockMovements.movementType, "out")
      ))
      .orderBy(desc(partsStockMovements.createdAt));

    // Récupérer aussi depuis parts_used pour compatibilité avec les anciennes données
    const { partsUsed } = await import("@shared/schema");
    const usageFromPartsUsed = await db
      .select({
        id: partsUsed.id,
        workOrderId: partsUsed.workOrderId,
        workOrderTitle: workOrders.title,
        quantity: partsUsed.quantity,
        date: partsUsed.createdAt,
        vehicleRegistration: workOrders.vehicleRegistration
      })
      .from(partsUsed)
      .leftJoin(workOrders, eq(partsUsed.workOrderId, workOrders.id))
      .where(eq(partsUsed.partId, partId))
      .orderBy(desc(partsUsed.createdAt));

    // Fusionner les résultats et éviter les doublons par workOrderId
    const allUsage = [...usageFromMovements, ...usageFromPartsUsed];
    const uniqueUsage = allUsage.filter((usage, index, self) => 
      index === self.findIndex(u => u.workOrderId === usage.workOrderId)
    );

    console.log(`Found ${uniqueUsage.length} usage records for part ${partId} (${usageFromMovements.length} from movements, ${usageFromPartsUsed.length} from parts_used)`);
    return uniqueUsage.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}

export const partsService = new PartsService();
