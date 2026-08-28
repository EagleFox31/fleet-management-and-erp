import { db } from "../db";
import { suppliers, supplierInvoices, parts, users } from "../../shared/schema";
import { eq, and, desc, sql, ilike, or, inArray } from "drizzle-orm";
import type { Supplier, InsertSupplier } from "../../shared/schema";

export class SupplierManagementService {
  
  // Créer un nouveau fournisseur
  async createSupplier(data: InsertSupplier, createdBy?: number): Promise<Supplier> {
    const [supplier] = await db.insert(suppliers).values({
      ...data,
      createdBy: createdBy ?? null,
      updatedAt: new Date(),
    }).returning();
    
    console.log(`✅ Fournisseur créé: ${supplier.name}`);
    return supplier;
  }

  // Récupérer tous les fournisseurs avec filtres optionnels
  async getSuppliers(filters?: {
    isActive?: boolean;
    category?: string;
    search?: string;
  }): Promise<(Supplier & { createdByName?: string | null })[]> {
    let query = db.select().from(suppliers);

    const conditions: any[] = [];
    
    if (filters?.isActive !== undefined) {
      conditions.push(eq(suppliers.isActive, filters.isActive));
    }
    
    if (filters?.category) {
      // Utiliser ilike pour une recherche insensible à la casse et aux accents
      conditions.push(ilike(suppliers.category, filters.category));
    }
    
    if (filters?.search) {
      conditions.push(
        or(
          ilike(suppliers.name, `%${filters.search}%`),
          ilike(suppliers.contactName, `%${filters.search}%`),
          ilike(suppliers.email, `%${filters.search}%`)
        )!
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)!) as any;
    }

    const results = await query.orderBy(desc(suppliers.createdAt));

    const creatorIds = Array.from(
      new Set(
        results
          .map((supplier) => supplier.createdBy)
          .filter((value): value is number => typeof value === "number")
      )
    );

    const creatorNameById = new Map<number, string>();
    if (creatorIds.length > 0) {
      const creatorRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, creatorIds));
      for (const creator of creatorRows) {
        creatorNameById.set(creator.id, creator.name);
      }
    }

    return results.map((supplier) => ({
      ...supplier,
      createdByName:
        typeof supplier.createdBy === "number"
          ? creatorNameById.get(supplier.createdBy) ?? null
          : null,
    }));
  }

  // Récupérer un fournisseur par ID avec statistiques
  async getSupplierById(id: number): Promise<{
    supplier: Supplier & { createdByName?: string | null };
    statistics: {
      totalInvoices: number;
      totalAmount: number;
      totalPaid: number;
      totalPending: number;
      partsCount: number;
    };
  } | null> {
    const [supplierResult] = await db
      .select({
        supplier: suppliers,
        createdByName: users.name,
      })
      .from(suppliers)
      .leftJoin(users, eq(suppliers.createdBy, users.id))
      .where(eq(suppliers.id, id));
    
    if (!supplierResult) {
      return null;
    }

    const supplier = {
      ...supplierResult.supplier,
      createdByName: supplierResult.createdByName,
    };

    // Calculer les statistiques du fournisseur
    const invoiceStats = await db
      .select({
        totalInvoices: sql<number>`count(*)::int`,
        totalAmount: sql<number>`COALESCE(sum(${supplierInvoices.totalTTC}), 0)`,
        totalPaid: sql<number>`COALESCE(sum(CASE WHEN ${supplierInvoices.isPaymentComplete} THEN ${supplierInvoices.totalTTC} ELSE 0 END), 0)`,
        totalPending: sql<number>`COALESCE(sum(${supplierInvoices.balance}), 0)`,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.supplierId, id));

    // Compter les pièces du fournisseur
    const partsCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(parts)
      .where(eq(parts.supplier, supplier.name));

    return {
      supplier,
      statistics: {
        totalInvoices: invoiceStats[0]?.totalInvoices || 0,
        totalAmount: Number(invoiceStats[0]?.totalAmount || 0),
        totalPaid: Number(invoiceStats[0]?.totalPaid || 0),
        totalPending: Number(invoiceStats[0]?.totalPending || 0),
        partsCount: partsCount[0]?.count || 0,
      }
    };
  }

  // Mettre à jour un fournisseur
  async updateSupplier(id: number, data: Partial<InsertSupplier>): Promise<Supplier | null> {
    const [updated] = await db
      .update(suppliers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();
    
    if (updated) {
      console.log(`✅ Fournisseur mis à jour: ${updated.name}`);
    }
    
    return updated || null;
  }

  // Désactiver un fournisseur (soft delete)
  async deactivateSupplier(id: number): Promise<boolean> {
    const [updated] = await db
      .update(suppliers)
      .set({ 
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();
    
    if (updated) {
      console.log(`✅ Fournisseur désactivé: ${updated.name}`);
      return true;
    }
    
    return false;
  }

  // Réactiver un fournisseur
  async reactivateSupplier(id: number): Promise<boolean> {
    const [updated] = await db
      .update(suppliers)
      .set({ 
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();
    
    if (updated) {
      console.log(`✅ Fournisseur réactivé: ${updated.name}`);
      return true;
    }
    
    return false;
  }

  // Mettre à jour les évaluations de performance d'un fournisseur
  async updateSupplierRating(
    id: number, 
    ratings: {
      qualityRating?: number;
      reliabilityRating?: number;
      priceCompetitiveness?: number;
    }
  ): Promise<Supplier | null> {
    // Valider les notes (0-5)
    const validatedRatings: any = {};
    
    if (ratings.qualityRating !== undefined) {
      validatedRatings.qualityRating = Math.max(0, Math.min(5, ratings.qualityRating)).toFixed(2);
    }
    
    if (ratings.reliabilityRating !== undefined) {
      validatedRatings.reliabilityRating = Math.max(0, Math.min(5, ratings.reliabilityRating)).toFixed(2);
    }
    
    if (ratings.priceCompetitiveness !== undefined) {
      validatedRatings.priceCompetitiveness = Math.max(0, Math.min(5, ratings.priceCompetitiveness)).toFixed(2);
    }

    const [updated] = await db
      .update(suppliers)
      .set({
        ...validatedRatings,
        updatedAt: new Date(),
      })
      .where(eq(suppliers.id, id))
      .returning();
    
    if (updated) {
      console.log(`✅ Évaluations mises à jour pour: ${updated.name}`);
    }
    
    return updated || null;
  }

  // Calculer automatiquement les évaluations basées sur l'historique
  async calculateAutomaticRatings(supplierId: number): Promise<{
    qualityRating: number;
    reliabilityRating: number;
    priceCompetitiveness: number;
  } | null> {
    const supplier = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    
    if (supplier.length === 0) {
      return null;
    }

    // Récupérer toutes les factures du fournisseur
    const invoices = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.supplierId, supplierId));

    if (invoices.length === 0) {
      return {
        qualityRating: 3.0, // Note par défaut
        reliabilityRating: 3.0,
        priceCompetitiveness: 3.0,
      };
    }

    // Calcul fiabilité: basé sur les paiements à temps
    const paidOnTime = invoices.filter(inv => 
      inv.isPaymentComplete && inv.paymentDate && 
      new Date(inv.paymentDate) <= new Date(inv.invoiceDate)
    ).length;
    const reliabilityRating = Math.min(5, (paidOnTime / invoices.length) * 5);

    // Calcul qualité: basé sur l'absence de litiges (assumed from payment completion)
    const completedPayments = invoices.filter(inv => inv.isPaymentComplete).length;
    const qualityRating = Math.min(5, (completedPayments / invoices.length) * 5);

    // Calcul compétitivité prix: basé sur la moyenne des montants (plus bas = meilleur)
    const avgAmount = invoices.reduce((sum, inv) => sum + Number(inv.totalTTC || 0), 0) / invoices.length;
    // Note inversée: montants plus bas = meilleure note (échelle arbitraire pour exemple)
    const priceCompetitiveness = Math.max(0, Math.min(5, 5 - (avgAmount / 100000)));

    return {
      qualityRating: Number(qualityRating.toFixed(2)),
      reliabilityRating: Number(reliabilityRating.toFixed(2)),
      priceCompetitiveness: Number(priceCompetitiveness.toFixed(2)),
    };
  }

  // Obtenir les performances d'un fournisseur
  async getSupplierPerformance(supplierId: number): Promise<{
    supplier: Supplier;
    ratings: {
      quality: number;
      reliability: number;
      priceCompetitiveness: number;
      overall: number;
    };
    deliveryMetrics: {
      onTimeDeliveries: number;
      lateDeliveries: number;
      onTimePercentage: number;
    };
    financialMetrics: {
      totalSpent: number;
      averageInvoiceAmount: number;
      pendingAmount: number;
    };
  } | null> {
    const supplierData = await this.getSupplierById(supplierId);
    
    if (!supplierData) {
      return null;
    }

    const { supplier, statistics } = supplierData;

    // Calculer les métriques de livraison (basées sur les factures)
    const invoices = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.supplierId, supplierId));

    const onTimeDeliveries = invoices.filter(inv => inv.isPaymentComplete).length;
    const lateDeliveries = invoices.filter(inv => !inv.isPaymentComplete).length;
    const totalDeliveries = invoices.length || 1; // éviter division par zéro

    // Calcul de la note globale
    const quality = Number(supplier.qualityRating || 0);
    const reliability = Number(supplier.reliabilityRating || 0);
    const price = Number(supplier.priceCompetitiveness || 0);
    const overall = (quality + reliability + price) / 3;

    return {
      supplier,
      ratings: {
        quality,
        reliability,
        priceCompetitiveness: price,
        overall: Number(overall.toFixed(2)),
      },
      deliveryMetrics: {
        onTimeDeliveries,
        lateDeliveries,
        onTimePercentage: Number(((onTimeDeliveries / totalDeliveries) * 100).toFixed(2)),
      },
      financialMetrics: {
        totalSpent: statistics.totalPaid,
        averageInvoiceAmount: statistics.totalInvoices > 0 
          ? Number((statistics.totalAmount / statistics.totalInvoices).toFixed(2))
          : 0,
        pendingAmount: statistics.totalPending,
      },
    };
  }

  // Obtenir le top 5 des fournisseurs par volume d'achats
  async getTopSuppliersByVolume(limit: number = 5): Promise<Array<{
    supplier: Supplier;
    totalSpent: number;
    invoiceCount: number;
  }>> {
    const topSuppliers = await db
      .select({
        supplier: suppliers,
        totalSpent: sql<number>`COALESCE(sum(${supplierInvoices.totalTTC}), 0)`,
        invoiceCount: sql<number>`count(${supplierInvoices.id})::int`,
      })
      .from(suppliers)
      .leftJoin(supplierInvoices, eq(suppliers.id, supplierInvoices.supplierId))
      .where(eq(suppliers.isActive, true))
      .groupBy(suppliers.id)
      .orderBy(desc(sql`COALESCE(sum(${supplierInvoices.totalTTC}), 0)`))
      .limit(limit);

    return topSuppliers.map(item => ({
      supplier: item.supplier,
      totalSpent: Number(item.totalSpent),
      invoiceCount: item.invoiceCount,
    }));
  }

  // Rechercher des fournisseurs
  async searchSuppliers(searchTerm: string): Promise<Supplier[]> {
    return await db
      .select()
      .from(suppliers)
      .where(
        or(
          ilike(suppliers.name, `%${searchTerm}%`),
          ilike(suppliers.contactName, `%${searchTerm}%`),
          ilike(suppliers.email, `%${searchTerm}%`),
          ilike(suppliers.category, `%${searchTerm}%`)
        )!
      )
      .orderBy(desc(suppliers.createdAt));
  }
}

export const supplierManagementService = new SupplierManagementService();
