import { workOrderStaffScope } from "../lib/work-order-realtime-scope";
import { db } from "../db";
import { 
  purchaseOrders, 
  purchaseOrderLines,
  partRequirements,
  partsStockMovements,
  parts,
  supplierInvoices,
  suppliers,
  users,
  alerts,
  workOrders,
  PurchaseOrder,
  InsertPurchaseOrder,
  PurchaseOrderLine,
  InsertPurchaseOrderLine,
  PartRequirement
} from "@shared/schema";
import { eq, and, desc, sql, inArray, gte, lte, or } from "drizzle-orm";
import { threeWayMatchingService } from "./three-way-matching-service";
import { AppError } from "../lib/app-error";
import { broadcastAlertCreated, type BroadcastableAlert } from "../lib/alert-broadcast";
import { moduleLogger } from "../lib/logger";
import { canTransitionPurchaseOrder, getPurchaseOrderStatusLabel } from "@shared/constants/purchase-order-statuses";

/**
 * Service de gestion des commandes d'achat groupées
 * Optimise les coûts via regroupement automatique et remises volume
 * Objectif : 5-10% d'économies sur les achats
 */
const log = moduleLogger("procurement-service");

export class ProcurementService {
  private readonly VAT_RATE = 19.25; // TVA au Cameroun
  private readonly ROLE_LABELS: Record<string, string> = {
    admin: "Administrateur",
    workshop_manager: "Chef d'atelier",
    warehouse: "Magasinier",
    secretary: "Secrétaire",
    logistics: "Achats / Logistique",
    technician: "Technicien",
  };

  /**
   * Helper pour parser les numeric columns en number
   */
  private num(v: unknown): number {
    return Number.parseFloat(String(v ?? 0));
  }

  private dateOnly(value: Date): string {
    return value.toISOString().split("T")[0];
  }

  private addDays(baseDate: string, days: number): string {
    const base = new Date(`${baseDate}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      return this.dateOnly(new Date());
    }

    base.setUTCDate(base.getUTCDate() + Math.max(0, days));
    return this.dateOnly(base);
  }

  private async generateAutoInvoiceNumber(orderNumber: string): Promise<string> {
    const base = `AUTO-${orderNumber}`;

    const [baseExists] = await db
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.invoiceNumber, base))
      .limit(1);

    if (!baseExists) {
      return base;
    }

    for (let suffix = 2; suffix <= 999; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      const [existing] = await db
        .select({ id: supplierInvoices.id })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.invoiceNumber, candidate))
        .limit(1);

      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now()}`;
  }

  private async ensureAutoSupplierInvoiceFromOrder(
    orderId: number,
    actorId?: number
  ): Promise<{ created: boolean; invoiceId?: number; invoiceNumber?: string }> {
    const [existingInvoice] = await db
      .select({
        id: supplierInvoices.id,
        invoiceNumber: supplierInvoices.invoiceNumber,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.purchaseOrderId, orderId))
      .orderBy(desc(supplierInvoices.createdAt))
      .limit(1);

    if (existingInvoice) {
      return {
        created: false,
        invoiceId: existingInvoice.id,
        invoiceNumber: existingInvoice.invoiceNumber,
      };
    }

    const [orderData] = await db
      .select({
        order: purchaseOrders,
        supplierPaymentTerms: suppliers.paymentTerms,
        supplierCategory: suppliers.category,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(eq(purchaseOrders.id, orderId))
      .limit(1);

    if (!orderData) {
      return { created: false };
    }

    const { order, supplierPaymentTerms, supplierCategory } = orderData;
    if (!order.supplierId) {
      return { created: false };
    }

    const lines = await db
      .select({
        quantityOrdered: purchaseOrderLines.quantityOrdered,
        quantityReceived: purchaseOrderLines.quantityReceived,
        partId: purchaseOrderLines.partId,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));

    const totalQuantity = lines.reduce((sum, line) => {
      const ordered = line.quantityOrdered || 0;
      const received = line.quantityReceived || 0;
      return sum + Math.max(ordered, received);
    }, 0);

    // amountHT commande = brut avant remise.
    // Pour la facture fournisseur, on doit utiliser la base nette après remise.
    const grossAmountHT = this.num(order.totalAmountHT);
    const discountAmount = this.num(order.discountAmount);
    const netAmountHT = Math.max(grossAmountHT - discountAmount, 0);
    const vatAmount = this.num(order.vatAmount) || (netAmountHT * this.VAT_RATE) / 100;
    const totalAmountTTC = this.num(order.totalAmountTTC) || netAmountHT + vatAmount;
    const invoiceDate = order.actualDeliveryDate || order.orderDate || this.dateOnly(new Date());
    const paymentTermsDays = Math.max(0, Number(supplierPaymentTerms ?? 30));
    const dueDate = this.addDays(invoiceDate, paymentTermsDays);
    const invoiceNumber = await this.generateAutoInvoiceNumber(order.orderNumber);

    const hasPartsLines = lines.some((line) => typeof line.partId === "number");

    const { invoice } = await threeWayMatchingService.createSupplierInvoice(
      {
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        invoiceNumber,
        invoiceDate,
        dueDate,
        family: hasPartsLines ? "Pièces détachées" : (supplierCategory || "Approvisionnement"),
        description: `Facture auto-générée depuis la commande ${order.orderNumber} après réception`,
        quantity: String(Math.max(1, totalQuantity)),
        subtotal: String(netAmountHT),
        amountHT: String(netAmountHT),
        taxAmount: String(vatAmount),
        vatAmount: String(vatAmount),
        totalAmount: String(totalAmountTTC),
        totalTTC: String(totalAmountTTC),
        balance: String(totalAmountTTC),
        status: "received",
        notes: `Auto-générée à la réception de la commande ${order.orderNumber}.`,
      },
      actorId
    );

    console.log(`🧾 Facture fournisseur auto créée pour commande #${orderId}: ${invoice.invoiceNumber}`);

    return {
      created: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  async ensureSupplierInvoiceGenerated(
    orderId: number,
    actorId?: number
  ): Promise<{ created: boolean; invoiceId?: number; invoiceNumber?: string }> {
    return this.ensureAutoSupplierInvoiceFromOrder(orderId, actorId);
  }

  /**
   * Quand une commande est réceptionnée globalement, aligner les lignes de commande.
   * Cela évite les incohérences "commande livrée" mais lignes "pending".
   */
  private async markOrderLinesAsDelivered(orderId: number): Promise<void> {
    await db
      .update(purchaseOrderLines)
      .set({
        deliveryStatus: sql`CASE
          WHEN ${purchaseOrderLines.deliveryStatus} IN ('pending', 'partial')
          THEN 'delivered'
          ELSE ${purchaseOrderLines.deliveryStatus}
        END`,
        quantityReceived: sql`CASE
          WHEN ${purchaseOrderLines.deliveryStatus} IN ('pending', 'partial')
          THEN ${purchaseOrderLines.quantityOrdered}
          ELSE ${purchaseOrderLines.quantityReceived}
        END`,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
  }

  /**
   * Crédite le stock d'une pièce lors de la réception fournisseur et trace le mouvement.
   */
  private async registerPartReception(
    partId: number,
    quantity: number,
    reason: string,
    notes: string,
    createdBy?: number
  ): Promise<void> {
    if (quantity <= 0) return;

    // Incrément atomique : deux réceptions simultanées ne s'écrasent pas.
    const [credited] = await db
      .update(parts)
      .set({ quantity: sql`coalesce(${parts.quantity}, 0) + ${quantity}` })
      .where(eq(parts.id, partId))
      .returning({ quantity: parts.quantity });

    if (!credited) return;

    const newStock = credited.quantity || 0;
    const previousStock = newStock - quantity;

    await db.insert(partsStockMovements).values({
      partId,
      movementType: "in",
      quantity,
      previousStock,
      newStock,
      reason,
      notes,
      createdBy,
    });
  }

  private appendOrderTrace(existingNotes: string | null | undefined, traceLine: string): string {
    const base = (existingNotes || "").trim();
    return base ? `${base}\n${traceLine}` : traceLine;
  }

  private parseOrderTrace(notes: string | null | undefined): Array<{
    timestamp: string;
    fromStatus: string;
    toStatus: string;
    actor: string;
    deliveryCode?: string;
    cancellationReason?: string;
  }> {
    if (!notes) return [];

    return notes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[TRACE_PO]"))
      .map((line) => {
        // Format:
        // [TRACE_PO] 2026-03-02T09:20:00.000Z | draft -> sent | by=Nom (role) | deliveryCode=BL-001 | cancelReason=...
        const raw = line.replace("[TRACE_PO]", "").trim();
        const parts = raw.split("|").map((part) => part.trim());
        const timestamp = parts[0] || "";
        const transition = parts[1] || "";
        const actorRaw = parts.find((p) => p.startsWith("by=")) || "";
        const codeRaw = parts.find((p) => p.startsWith("deliveryCode=")) || "";
        const cancelReasonRaw = parts.find((p) => p.startsWith("cancelReason=")) || "";

        const [fromStatus = "", toStatus = ""] = transition
          .split("->")
          .map((status) => status.trim());

        return {
          timestamp,
          fromStatus,
          toStatus,
          actor: actorRaw.replace(/^by=/, "").trim(),
          deliveryCode: codeRaw ? codeRaw.replace(/^deliveryCode=/, "").trim() : undefined,
          cancellationReason: (() => {
            if (!cancelReasonRaw) return undefined;
            const rawReason = cancelReasonRaw.replace(/^cancelReason=/, "").trim();
            try {
              return decodeURIComponent(rawReason);
            } catch {
              return rawReason;
            }
          })(),
        };
      })
      .filter((trace) => trace.timestamp && trace.toStatus);
  }

  /**
   * Génère un numéro de commande unique (format: PO-YYYYMMDD-XXX)
   */
  private async generateOrderNumber(): Promise<string> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    
    // Compter les commandes du jour
    const pattern = `PO-${dateStr}-%`;
    const todayOrders = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(sql`${purchaseOrders.orderNumber} LIKE ${pattern}`);
    
    const count = todayOrders[0]?.count || 0;
    const sequence = String(count + 1).padStart(3, '0');
    
    return `PO-${dateStr}-${sequence}`;
  }

  /**
   * MÉTHODE 1: Regroupement intelligent des demandes par fournisseur
   * Analyse les part requirements en attente et les groupe par fournisseur
   * Prend en compte l'urgence et les délais de livraison
   */
  async groupRequestsBySupplier(options?: {
    minRequirements?: number; // Minimum de demandes pour créer une commande groupée
    maxDaysOld?: number; // Age maximum des demandes (jours)
    urgencyThreshold?: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<{
    supplierId: number;
    supplierName: string;
    requirements: Array<PartRequirement & { partName?: string; estimatedPrice?: number }>;
    totalEstimatedCost: number;
    urgencyLevel: string;
    recommendedDiscount: number;
  }[]> {
    const minReqs = options?.minRequirements || 2;
    const maxDays = options?.maxDaysOld || 30;
    const urgencyMap = { low: 1, medium: 2, high: 3, critical: 4 };
    const thresholdLevel = urgencyMap[options?.urgencyThreshold || 'medium'];

    console.log(`📊 Regroupement des demandes - Min: ${minReqs} demandes, Max age: ${maxDays} jours`);

    // Récupérer toutes les demandes approuvées non encore commandées
    const pendingRequirements = await db
      .select({
        requirement: partRequirements,
        part: parts,
      })
      .from(partRequirements)
      .leftJoin(parts, eq(partRequirements.partId, parts.id))
      .where(
        and(
          eq(partRequirements.status, 'approved'),
          gte(
            partRequirements.createdAt,
            sql`NOW() - INTERVAL '${sql.raw(String(maxDays))} days'`
          )
        )
      )
      .orderBy(desc(partRequirements.urgency));

    // Grouper par fournisseur (via la pièce)
    const groupedBySupplier = new Map<string, {
      supplierId: number;
      supplierName: string;
      requirements: Array<PartRequirement & { partName?: string; estimatedPrice?: number }>;
      totalEstimatedCost: number;
      maxUrgency: number;
    }>();

    for (const { requirement, part } of pendingRequirements) {
      if (!part?.supplier) continue;

      const key = part.supplier;
      const urgencyLevel = urgencyMap[requirement.urgency as keyof typeof urgencyMap] || 2;
      
      // Filtrer par seuil d'urgence si spécifié
      if (urgencyLevel < thresholdLevel) continue;

      const estimatedPrice = this.num(requirement.estimatedCost) || 
                            (this.num(part.unitPrice) * requirement.quantityNeeded);

      if (!groupedBySupplier.has(key)) {
        groupedBySupplier.set(key, {
          supplierId: 0, // Sera mis à jour si on a un ID
          supplierName: key,
          requirements: [],
          totalEstimatedCost: 0,
          maxUrgency: 0,
        });
      }

      const group = groupedBySupplier.get(key)!;
      group.requirements.push({
        ...requirement,
        partName: part.name,
        estimatedPrice,
      });
      group.totalEstimatedCost += estimatedPrice;
      group.maxUrgency = Math.max(group.maxUrgency, urgencyLevel);
    }

    // Filtrer les groupes qui ont assez de demandes et calculer les remises
    const results: any[] = [];
    for (const [supplierName, group] of Array.from(groupedBySupplier.entries())) {
      if (group.requirements.length >= minReqs) {
        // Trouver le vrai ID du fournisseur si possible
        const [supplier] = await db
          .select()
          .from(suppliers)
          .where(eq(suppliers.name, supplierName))
          .limit(1);

        results.push({
          supplierId: supplier?.id || 0,
          supplierName,
          requirements: group.requirements,
          totalEstimatedCost: group.totalEstimatedCost,
          urgencyLevel: Object.keys(urgencyMap).find(k => urgencyMap[k as keyof typeof urgencyMap] === group.maxUrgency) || 'medium',
          recommendedDiscount: this.calculateVolumeDiscounts(group.totalEstimatedCost, group.requirements.length),
        });
      }
    }

    console.log(`✅ ${results.length} groupes de fournisseurs identifiés pour commandes groupées`);
    return results.sort((a, b) => b.totalEstimatedCost - a.totalEstimatedCost);
  }

  /**
   * MÉTHODE 2: Calcul des remises volume
   * Estime la remise potentielle basée sur le montant et la quantité
   * Règles de remise progressives
   */
  calculateVolumeDiscounts(totalAmount: number, itemCount: number): number {
    // Règles de remise basées sur le montant total
    let discount = 0;

    if (totalAmount >= 10000000) { // 10M FCFA
      discount = 10;
    } else if (totalAmount >= 5000000) { // 5M FCFA
      discount = 7;
    } else if (totalAmount >= 2000000) { // 2M FCFA
      discount = 5;
    } else if (totalAmount >= 1000000) { // 1M FCFA
      discount = 3;
    } else if (totalAmount >= 500000) { // 500K FCFA
      discount = 2;
    }

    // Bonus pour grande quantité d'articles
    if (itemCount >= 20) {
      discount += 2;
    } else if (itemCount >= 10) {
      discount += 1;
    }

    return Math.min(discount, 15); // Maximum 15% de remise
  }

  /**
   * MÉTHODE 3: Optimisation du timing des commandes
   * Suggère le meilleur moment pour passer commande en fonction
   * de l'urgence et du potentiel d'économie
   */
  async optimizeOrderTiming(supplierId: number): Promise<{
    shouldOrderNow: boolean;
    reason: string;
    potentialSavings: number;
    waitDays?: number;
  }> {
    const grouped = await this.groupRequestsBySupplier({
      minRequirements: 1,
      maxDaysOld: 14,
    });

    const supplierGroup = grouped.find(g => g.supplierId === supplierId);
    
    if (!supplierGroup) {
      return {
        shouldOrderNow: false,
        reason: "Aucune demande en attente pour ce fournisseur",
        potentialSavings: 0,
      };
    }

    // Vérifier l'urgence critique
    const hasCritical = supplierGroup.requirements.some(r => r.urgency === 'critical');
    const hasHigh = supplierGroup.requirements.some(r => r.urgency === 'high');

    if (hasCritical) {
      return {
        shouldOrderNow: true,
        reason: "Demandes critiques en attente",
        potentialSavings: 0,
      };
    }

    // Calculer le potentiel d'économie en attendant
    const currentDiscount = this.calculateVolumeDiscounts(
      supplierGroup.totalEstimatedCost,
      supplierGroup.requirements.length
    );

    // Estimer le potentiel avec plus de demandes (hypothèse: +30% en 7 jours)
    const estimatedFutureAmount = supplierGroup.totalEstimatedCost * 1.3;
    const estimatedFutureCount = Math.ceil(supplierGroup.requirements.length * 1.3);
    const futureDiscount = this.calculateVolumeDiscounts(estimatedFutureAmount, estimatedFutureCount);

    const additionalSavings = (futureDiscount - currentDiscount) / 100 * estimatedFutureAmount;

    if (hasHigh) {
      return {
        shouldOrderNow: true,
        reason: "Demandes haute priorité",
        potentialSavings: 0,
      };
    }

    if (additionalSavings > 100000 && !hasHigh) { // Plus de 100K FCFA d'économie potentielle
      return {
        shouldOrderNow: false,
        reason: `Attendre permettrait d'économiser ~${Math.round(additionalSavings).toLocaleString()} FCFA`,
        potentialSavings: additionalSavings,
        waitDays: 7,
      };
    }

    return {
      shouldOrderNow: true,
      reason: "Bon moment pour commander - équilibre prix/délai optimal",
      potentialSavings: currentDiscount / 100 * supplierGroup.totalEstimatedCost,
    };
  }

  /**
   * MÉTHODE 4: Créer une commande d'achat
   * Crée une commande avec ses lignes à partir de demandes groupées OU lignes manuelles
   */
  async createPurchaseOrder(data: {
    supplierId: number;
    requirementIds?: number[];
    requirementQuantities?: Array<{
      requirementId: number;
      quantityOrdered: number;
    }>;
    manualLines?: Array<{
      description: string;
      quantityOrdered: number;
      unitPrice: number;
    }>;
    discountPercentage?: number;
    notes?: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    createdBy: number;
  }): Promise<PurchaseOrder & { lines: PurchaseOrderLine[] }> {
    // Pas de commande vers un fournisseur désactivé (ni inexistant).
    const [supplier] = await db
      .select({ isActive: suppliers.isActive })
      .from(suppliers)
      .where(eq(suppliers.id, data.supplierId))
      .limit(1);
    if (!supplier) {
      throw new AppError(404, "Fournisseur introuvable");
    }
    if (supplier.isActive === false) {
      throw new AppError(409, "Ce fournisseur est désactivé : réactivez-le avant de lui passer commande");
    }

    const requirementIds = data.requirementIds || [];
    const requirementQuantities = data.requirementQuantities || [];
    const manualLines = data.manualLines || [];
    const quantityOverrides = new Map<number, number>(
      requirementQuantities
        .filter((item) => Number.isFinite(item.requirementId) && Number.isFinite(item.quantityOrdered))
        .map((item) => [item.requirementId, Math.max(1, Math.floor(item.quantityOrdered))])
    );
    
    console.log(`📝 Création commande pour fournisseur ${data.supplierId} avec ${requirementIds.length} demandes + ${manualLines.length} lignes manuelles`);

    // Calculer les totaux
    let totalHT = 0;
    const lines: Array<Omit<InsertPurchaseOrderLine, 'purchaseOrderId'>> = [];

    // Ajouter les lignes depuis les demandes de pièces
    if (requirementIds.length > 0) {
      const requirements = await db
        .select({
          requirement: partRequirements,
          part: parts,
        })
        .from(partRequirements)
        .leftJoin(parts, eq(partRequirements.partId, parts.id))
        .where(inArray(partRequirements.id, requirementIds));

      for (const { requirement, part } of requirements) {
        const requestedQty = Math.max(1, Number(requirement.quantityNeeded || 1));
        const desiredQty = Math.max(
          requestedQty,
          quantityOverrides.get(requirement.id) ?? requestedQty
        );
        const estimatedCostValue = this.num(requirement.estimatedCost);
        const unitPriceFromRequirement = requestedQty > 0 ? estimatedCostValue / requestedQty : 0;
        const unitPrice =
          unitPriceFromRequirement > 0 ? unitPriceFromRequirement : this.num(part?.unitPrice) || 0;
        const totalPrice = unitPrice * desiredQty;
        
        totalHT += totalPrice;
        
        lines.push({
          partRequirementId: requirement.id,
          partId: requirement.partId,
          quantityOrdered: desiredQty,
          unitPrice: String(unitPrice),
          totalPrice: String(totalPrice),
          description: part?.name || requirement.reason,
          reference: part?.reference,
        });
      }
    }

    // Ajouter les lignes manuelles
    for (const manualLine of manualLines) {
      const totalPrice = manualLine.quantityOrdered * manualLine.unitPrice;
      totalHT += totalPrice;
      
      lines.push({
        partRequirementId: null,
        partId: null,
        quantityOrdered: manualLine.quantityOrdered,
        unitPrice: String(manualLine.unitPrice),
        totalPrice: String(totalPrice),
        description: manualLine.description,
        reference: null,
      });
    }

    if (lines.length === 0) {
      throw new Error("Aucune ligne de commande à créer");
    }

    // Appliquer la remise
    const discountPct = data.discountPercentage || 0;
    const discountAmount = (totalHT * discountPct) / 100;
    const totalAfterDiscount = totalHT - discountAmount;
    const vatAmount = (totalAfterDiscount * this.VAT_RATE) / 100;
    const totalTTC = totalAfterDiscount + vatAmount;

    // Générer le numéro de commande
    const orderNumber = await this.generateOrderNumber();

    // Date de livraison estimée (10 jours par défaut)
    const expectedDelivery = new Date();
    expectedDelivery.setDate(expectedDelivery.getDate() + 10);

    // Créer la commande
    const [order] = await db.insert(purchaseOrders).values({
      orderNumber,
      supplierId: data.supplierId,
      orderDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: expectedDelivery.toISOString().split('T')[0],
      status: 'draft',
      totalAmountHT: String(totalHT),
      vatAmount: String(vatAmount),
      totalAmountTTC: String(totalTTC),
      discountPercentage: String(discountPct),
      discountAmount: String(discountAmount),
      urgency: data.urgency || 'medium',
      notes: data.notes,
      createdBy: data.createdBy,
    }).returning();

    // Créer les lignes de commande
    const createdLines = await db.insert(purchaseOrderLines).values(
      lines.map(line => ({
        ...line,
        purchaseOrderId: order.id,
      }))
    ).returning();

    // Mettre à jour le statut des demandes (seulement si présentes)
    if (requirementIds.length > 0) {
      await db.update(partRequirements)
        .set({ 
          status: 'ordered',
          updatedAt: new Date(),
        })
        .where(inArray(partRequirements.id, requirementIds));
    }

    console.log(`✅ Commande ${orderNumber} créée avec ${createdLines.length} lignes - Total: ${Math.round(totalTTC).toLocaleString()} FCFA`);
    console.log(`📋 Order object:`, JSON.stringify({ id: order.id, orderNumber: order.orderNumber }));

    const result = {
      ...order,
      lines: createdLines,
    };
    
    console.log(`📦 Returning order with ID: ${result.id}`);
    
    return result;
  }

  /**
   * Récupérer toutes les commandes avec filtres
   */
  async getPurchaseOrders(filters?: {
    status?: string;
    supplierId?: number;
    createdBy?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Array<PurchaseOrder & { 
    supplier?: { id: number; name: string };
    creator?: { id: number; name: string };
    linesCount: number;
  }>> {
    let query = db
      .select({
        order: purchaseOrders,
        supplier: suppliers,
        creator: users,
        linesCount: sql<number>`count(${purchaseOrderLines.id})::int`,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(users, eq(purchaseOrders.createdBy, users.id))
      .leftJoin(purchaseOrderLines, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
      .groupBy(purchaseOrders.id, suppliers.id, users.id);

    const conditions: any[] = [];

    if (filters?.status) {
      conditions.push(sql`${purchaseOrders.status} = ${filters.status}`);
    }
    if (filters?.supplierId) {
      conditions.push(eq(purchaseOrders.supplierId, filters.supplierId));
    }
    if (filters?.createdBy) {
      conditions.push(eq(purchaseOrders.createdBy, filters.createdBy));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(purchaseOrders.orderDate, filters.dateFrom));
    }
    if (filters?.dateTo) {
      conditions.push(lte(purchaseOrders.orderDate, filters.dateTo));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)!) as any;
    }

    const results = await query.orderBy(desc(purchaseOrders.createdAt));

    return results.map(r => ({
      ...r.order,
      supplier: r.supplier ? { id: r.supplier.id, name: r.supplier.name } : undefined,
      creator: r.creator ? { id: r.creator.id, name: r.creator.name } : undefined,
      linesCount: r.linesCount || 0,
    }));
  }

  /**
   * Récupérer une commande par ID avec détails complets
   */
  async getPurchaseOrderById(id: number): Promise<{
    order: PurchaseOrder;
    supplier?: { id: number; name: string; email?: string; phone?: string };
    linkedInvoice?: { id: number; invoiceNumber: string; status: string; totalAmountTTC: string | null; createdAt: Date | null };
    lines: Array<PurchaseOrderLine & { 
      part?: { id: number; name: string; reference: string };
      requirement?: { id: number; reason: string; urgency: string; requestedBy?: number | null };
    }>;
    creator?: { id: number; name: string };
    approver?: { id: number; name: string };
    requesters: Array<{ id: number; name: string; role?: string }>;
    statusHistory: Array<{
      timestamp: string;
      fromStatus: string;
      toStatus: string;
      actor: string;
      deliveryCode?: string;
      cancellationReason?: string;
    }>;
  } | null> {
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id));

    if (!order) return null;

    // Récupérer les détails
    const [supplier] = order.supplierId 
      ? await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId))
      : [null];

    const [creator] = order.createdBy
      ? await db.select().from(users).where(eq(users.id, order.createdBy))
      : [null];

    const [approver] = order.approvedBy
      ? await db.select().from(users).where(eq(users.id, order.approvedBy))
      : [null];

    // Récupérer les lignes avec détails
    const fetchLinesWithDetails = () =>
      db
        .select({
          line: purchaseOrderLines,
          part: parts,
          requirement: partRequirements,
        })
        .from(purchaseOrderLines)
        .leftJoin(parts, eq(purchaseOrderLines.partId, parts.id))
        .leftJoin(partRequirements, eq(purchaseOrderLines.partRequirementId, partRequirements.id))
        .where(eq(purchaseOrderLines.purchaseOrderId, id));

    let lines = await fetchLinesWithDetails();

    // Auto-rattrapage pour les anciennes commandes déjà réceptionnées
    // dont les lignes sont restées "pending"/"partial" par incohérence historique.
    const shouldNormalizeDeliveredLines =
      (order.status === "delivered" || order.status === "completed")
      && lines.some(({ line }) => {
        const qtyReceived = Number(line.quantityReceived ?? 0);
        const qtyOrdered = Number(line.quantityOrdered ?? 0);
        return line.deliveryStatus === "pending" || line.deliveryStatus === "partial" || qtyReceived < qtyOrdered;
      });

    if (shouldNormalizeDeliveredLines) {
      await this.markOrderLinesAsDelivered(id);
      lines = await fetchLinesWithDetails();
    }

    const requesterIds = Array.from(
      new Set(
        lines
          .map((line) => line.requirement?.requestedBy)
          .filter((requesterId): requesterId is number => typeof requesterId === "number")
      )
    );

    const requesterUsers = requesterIds.length
      ? await db
          .select({
            id: users.id,
            name: users.name,
            role: users.role,
          })
          .from(users)
          .where(inArray(users.id, requesterIds))
      : [];

    const [linkedInvoice] = await db
      .select({
        id: supplierInvoices.id,
        invoiceNumber: supplierInvoices.invoiceNumber,
        status: supplierInvoices.status,
        totalAmountTTC: supplierInvoices.totalTTC,
        createdAt: supplierInvoices.createdAt,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.purchaseOrderId, id))
      .orderBy(desc(supplierInvoices.createdAt))
      .limit(1);

    return {
      order,
      supplier: supplier ? {
        id: supplier.id,
        name: supplier.name,
        email: supplier.email || undefined,
        phone: supplier.phone || undefined,
      } : undefined,
      lines: lines.map(l => ({
        ...l.line,
        part: l.part ? { id: l.part.id, name: l.part.name, reference: l.part.reference } : undefined,
        requirement: l.requirement ? { 
          id: l.requirement.id, 
          reason: l.requirement.reason, 
          urgency: l.requirement.urgency,
          requestedBy: l.requirement.requestedBy,
        } : undefined,
      })),
      creator: creator ? { id: creator.id, name: creator.name } : undefined,
      approver: approver ? { id: approver.id, name: approver.name } : undefined,
      requesters: requesterUsers.map((requester) => ({
        id: requester.id,
        name: requester.name,
        role: requester.role || undefined,
      })),
      linkedInvoice: linkedInvoice || undefined,
      statusHistory: this.parseOrderTrace(order.notes),
    };
  }

  /**
   * Mettre à jour le statut d'une commande
   */
  async updateOrderStatus(
    orderId: number,
    status: 'draft' | 'sent' | 'confirmed' | 'cancellation_requested' | 'partial' | 'delivered' | 'completed' | 'cancelled',
    userId?: number,
    deliveryCode?: string,
    cancellationReason?: string
  ): Promise<PurchaseOrder> {
    const [currentOrder] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .limit(1);

    if (!currentOrder) {
      throw new AppError(404, "Commande introuvable.");
    }

    if (currentOrder.status === status) {
      return currentOrder;
    }

    if (!canTransitionPurchaseOrder(currentOrder.status, status)) {
      throw new AppError(
        409,
        `Impossible de passer la commande de « ${getPurchaseOrderStatusLabel(currentOrder.status)} » à « ${getPurchaseOrderStatusLabel(status)} ».`,
      );
    }

    // Règle métier stricte:
    // la clôture commande ne peut intervenir que lorsque la finance a terminé.
    if (status === "completed") {
      const linkedInvoices = await db
        .select({
          id: supplierInvoices.id,
          invoiceNumber: supplierInvoices.invoiceNumber,
          status: supplierInvoices.status,
        })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.purchaseOrderId, orderId));

      if (linkedInvoices.length === 0) {
        throw new AppError(409, "Clôture impossible : aucune facture fournisseur n'est rattachée à cette commande.");
      }

      const unpaidInvoices = linkedInvoices.filter((invoice) => invoice.status !== "paid");
      if (unpaidInvoices.length > 0) {
        const pendingRefs = unpaidInvoices
          .map((invoice) => invoice.invoiceNumber)
          .filter(Boolean)
          .join(", ");
        throw new AppError(
          409,
          `Clôture impossible : facture(s) fournisseur non payée(s)${pendingRefs ? ` (${pendingRefs})` : ""}.`,
        );
      }
    }

    const deliveryStockDeltas = status === "delivered"
      ? await db
          .select({
            lineId: purchaseOrderLines.id,
            partId: purchaseOrderLines.partId,
            quantityOrdered: purchaseOrderLines.quantityOrdered,
            quantityReceived: purchaseOrderLines.quantityReceived,
          })
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, orderId))
      : [];

    let actorLabel = userId ? `Utilisateur #${userId}` : "Systeme";
    let actorRole = "";
    if (userId) {
      const [actor] = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (actor) {
        actorLabel = (actor.name || actor.username || `Utilisateur #${userId}`).trim();
        if (actor.role) {
          const normalizedRole = actor.role.trim().toLowerCase();
          actorRole = ` (${this.ROLE_LABELS[normalizedRole] || actor.role})`;
        }
      }
    }

    const normalizedCancellationReason =
      status === "cancellation_requested" ? cancellationReason?.trim() : undefined;

    const traceLine = [
      `[TRACE_PO] ${new Date().toISOString()}`,
      `${currentOrder.status} -> ${status}`,
      `by=${actorLabel}${actorRole}`,
      deliveryCode ? `deliveryCode=${deliveryCode}` : "",
      normalizedCancellationReason ? `cancelReason=${encodeURIComponent(normalizedCancellationReason)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    const updateData: any = {
      status,
      updatedAt: new Date(),
      notes: this.appendOrderTrace(currentOrder.notes, traceLine),
    };

    // Si on approuve, enregistrer l'approbateur
    if (status === 'sent' && userId) {
      updateData.approvedBy = userId;
      updateData.approvedAt = new Date();
    }

    // Si on marque comme livré, enregistrer le code de livraison et la date
    if (status === 'delivered' && deliveryCode) {
      updateData.deliveryCode = deliveryCode;
      updateData.actualDeliveryDate = new Date();
    }

    const [updated] = await db
      .update(purchaseOrders)
      .set(updateData)
      .where(eq(purchaseOrders.id, orderId))
      .returning();

    // Réception complète: aligner automatiquement toutes les lignes
    // pour éviter "commande livrée" avec lignes restées en attente fournisseur.
    if (status === "delivered") {
      await this.markOrderLinesAsDelivered(orderId);

      for (const line of deliveryStockDeltas) {
        if (!line.partId) continue;

        const alreadyReceived = line.quantityReceived || 0;
        const ordered = line.quantityOrdered || 0;
        const quantityToReceive = Math.max(0, ordered - alreadyReceived);
        if (quantityToReceive <= 0) continue;

        await this.registerPartReception(
          line.partId,
          quantityToReceive,
          `Réception commande #${orderId}`,
          `Entrée stock depuis commande fournisseur, ligne #${line.lineId}`,
          userId
        );
      }
    }

    // Synchroniser le statut des demandes de pièces liées à la commande
    if (status === 'partial' || status === 'delivered') {
      const requirementIdRows = await db
        .select({
          requirementId: purchaseOrderLines.partRequirementId,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, orderId),
            sql`${purchaseOrderLines.partRequirementId} IS NOT NULL`
          )
        );

      const requirementIds = requirementIdRows
        .map((row) => row.requirementId)
        .filter((id): id is number => typeof id === 'number');

      if (requirementIds.length > 0) {
        if (status === 'partial') {
          await db
            .update(partRequirements)
            .set({
              status: 'partially_received',
              receivedBy: userId ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(partRequirements.id, requirementIds),
                inArray(partRequirements.status, ['ordered'])
              )
            );
        } else {
          await db
            .update(partRequirements)
            .set({
              status: 'received',
              receivedBy: userId ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(partRequirements.id, requirementIds),
                inArray(partRequirements.status, ['ordered', 'partially_received'])
              )
            );
        }
      }
    }

    // Étape métier: réception => facture fournisseur auto si absente + relais finance.
    let financeRelay: { created: boolean; invoiceId?: number; invoiceNumber?: string } | undefined;
    if (status === "delivered") {
      financeRelay = await this.ensureAutoSupplierInvoiceFromOrder(orderId, userId);
    }

    console.log(`📋 Commande #${orderId} passée au statut: ${status}${deliveryCode ? ` (Code: ${deliveryCode})` : ''}`);
    if (status === "delivered") {
      const invoiceRef = financeRelay?.invoiceNumber || `#${financeRelay?.invoiceId || "inconnue"}`;
      console.log(
        `💼 Relais finance actif pour commande #${orderId}: facture ${invoiceRef} (${financeRelay?.created ? "créée" : "existante"})`
      );
    }

    // Si la commande est livrée, notifier le chef d'atelier et les techniciens concernés
    if (status === 'delivered') {
      await this.notifyDeliveryReceived(orderId);
    }

    return updated;
  }

  /**
   * Mettre à jour une ligne de commande (réception, acceptation)
   */
  async updateOrderLine(
    lineId: number,
    data: {
      quantityReceived?: number;
      quantityAccepted?: number;
      quantityRejected?: number;
      deliveryStatus?: 'pending' | 'partial' | 'delivered' | 'accepted' | 'rejected';
    },
    userId?: number,
    orderId?: number
  ): Promise<PurchaseOrderLine> {
    const [currentLine] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, lineId))
      .limit(1);

    // Une ligne d'une autre commande que celle de l'URL est introuvable ici.
    if (!currentLine || (orderId !== undefined && currentLine.purchaseOrderId !== orderId)) {
      throw new AppError(404, "Ligne de commande introuvable.");
    }

    const previousReceived = currentLine.quantityReceived || 0;
    const nextReceived = data.quantityReceived ?? previousReceived;
    if (nextReceived > currentLine.quantityOrdered) {
      throw new AppError(400, `Quantité reçue supérieure au commandé (${currentLine.quantityOrdered}).`);
    }
    if (nextReceived < previousReceived) {
      // Le stock déjà crédité ne serait pas repris : une correction passe par
      // un ajustement de stock tracé.
      throw new AppError(409, "Une quantité déjà reçue ne se retire pas ici : passez par un ajustement de stock.");
    }
    const nextAccepted = data.quantityAccepted ?? currentLine.quantityAccepted ?? 0;
    const nextRejected = data.quantityRejected ?? currentLine.quantityRejected ?? 0;
    if (nextAccepted + nextRejected > nextReceived) {
      throw new AppError(400, "Pièces acceptées et refusées dépassent la quantité reçue.");
    }

    // Écriture conditionnelle : si une autre réception a modifié la ligne
    // entre-temps, rien n'est écrit et le stock n'est pas crédité deux fois.
    const [updated] = await db
      .update(purchaseOrderLines)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrderLines.id, lineId),
          currentLine.quantityReceived === null
            ? sql`${purchaseOrderLines.quantityReceived} is null`
            : eq(purchaseOrderLines.quantityReceived, currentLine.quantityReceived),
        ),
      )
      .returning();

    if (!updated) {
      throw new AppError(409, "Cette ligne vient d'être modifiée par quelqu'un d'autre. Rechargez la commande.");
    }

    log.info({ lineId }, "ligne de commande mise à jour");

    const newReceived = updated.quantityReceived || 0;
    const receivedDelta = Math.max(0, newReceived - previousReceived);

    // Si la réception augmente, créditer le stock et tracer le mouvement.
    if (receivedDelta > 0 && updated.partId) {
      await this.registerPartReception(
        updated.partId,
        receivedDelta,
        `Réception commande #${updated.purchaseOrderId}`,
        `Entrée stock depuis mise à jour ligne #${lineId}`,
        userId
      );

      // Notifier les personnes concernées sur la quantité réellement ajoutée.
      await this.notifyPartReceived(lineId, updated.partId, receivedDelta);
    }

    return updated;
  }

  /**
   * Notifie le chef d'atelier et les techniciens quand une commande est livrée
   * Trouve les OT en "awaiting_parts" qui attendaient des pièces de cette commande
   */
  private async notifyDeliveryReceived(orderId: number): Promise<void> {
    try {
      log.debug({ orderId }, "notification de livraison");

      // Récupérer uniquement les lignes réellement livrées (avec quantité reçue > 0)
      const orderLines = await db
        .select({
          lineId: purchaseOrderLines.id,
          partId: purchaseOrderLines.partId,
          partRequirementId: purchaseOrderLines.partRequirementId,
          quantityOrdered: purchaseOrderLines.quantityOrdered,
          quantityReceived: purchaseOrderLines.quantityReceived,
          deliveryStatus: purchaseOrderLines.deliveryStatus,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, orderId),
            or(
              inArray(purchaseOrderLines.deliveryStatus, ['delivered', 'accepted']),
              sql`${purchaseOrderLines.quantityReceived} > 0`
            )
          )
        );

      // Récupérer uniquement les IDs de pièces qui ont été effectivement livrées (pas les lignes manuelles)
      const deliveredPartIds = orderLines
        .filter(l => l.partId !== null && (l.quantityReceived ?? 0) > 0)
        .map(l => l.partId)
        .filter((id): id is number => id !== null);

      if (deliveredPartIds.length === 0) {
        log.debug({ orderId }, "aucune pièce à notifier");
        return;
      }

      // Trouver les OT en attente de ces pièces
      const affectedWorkOrders = await this.findWorkOrdersAwaitingParts(deliveredPartIds);

      if (affectedWorkOrders.length === 0) {
        log.debug({ orderId }, "aucune OT en attente de ces pièces");
        return;
      }

      // Récupérer les infos des pièces pour le message
      const partsInfo = await db
        .select({ id: parts.id, name: parts.name, reference: parts.reference })
        .from(parts)
        .where(inArray(parts.id, deliveredPartIds));

      const partsNames = partsInfo.map(p => p.name).join(', ');

      // Trouver le chef d'atelier (workshop_manager)
      const workshopManagers = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.role, 'workshop_manager'));

      // Collecter les techniciens à notifier (ceux assignés aux OT concernées)
      const technicianIds = new Set<number>();
      affectedWorkOrders.forEach(wo => {
        if (wo.technicianId) {
          technicianIds.add(wo.technicianId);
        }
      });

      const created: BroadcastableAlert[] = [];

      // Créer l'alerte pour le chef d'atelier
      for (const manager of workshopManagers) {
        const [alert] = await db.insert(alerts).values({
          userId: manager.id,
          title: 'Livraison reçue - Pièces disponibles',
          message: `Les pièces suivantes ont été livrées et sont maintenant disponibles: ${partsNames}. ${affectedWorkOrders.length} ordre(s) de travail en attente peu(ven)t être repris.`,
          type: 'inventory',
          priority: 'high',
          link: `/procurement/orders/${orderId}`,
        }).returning();
        created.push(alert);
      }

      // Créer l'alerte pour chaque technicien concerné
      for (const techId of Array.from(technicianIds)) {
        const techWorkOrders = affectedWorkOrders.filter(wo => wo.technicianId === techId);
        const woTitles = techWorkOrders.map(wo => wo.title).join(', ');

        const [alert] = await db.insert(alerts).values({
          userId: techId,
          title: 'Pièces disponibles pour vos OT',
          message: `Les pièces attendues pour vos ordres de travail sont arrivées: ${woTitles}. Vous pouvez reprendre le travail.`,
          type: 'work_order',
          priority: 'high',
          link: `/maintenance/work-orders/${techWorkOrders[0].id}`,
        }).returning();
        created.push(alert);
      }

      // Couche 2 : sans cette trame, la cloche et le toast ne bougeaient pas.
      for (const alert of created) broadcastAlertCreated(alert);
      log.info({ orderId, alerts: created.length }, "livraison notifiée");

      // Diffuser via WebSocket pour mise à jour temps réel
      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('parts_delivered', {
          scope: workOrderStaffScope(),
          orderId,
          partIds: deliveredPartIds,
          affectedWorkOrderIds: affectedWorkOrders.map(wo => wo.id),
        });
        log.debug({ orderId }, "parts_delivered diffusé");
      }

    } catch (error) {
      log.error({ err: error, orderId }, "notification de livraison");
    }
  }

  /**
   * Notifie quand une pièce spécifique est reçue (réception partielle)
   */
  private async notifyPartReceived(lineId: number, partId: number | null, quantityReceived: number): Promise<void> {
    if (!partId) return;

    try {
      log.debug({ lineId, partId, quantityReceived }, "notification de réception pièce");

      // Trouver les OT en attente de cette pièce
      const affectedWorkOrders = await this.findWorkOrdersAwaitingParts([partId]);

      if (affectedWorkOrders.length === 0) {
        log.debug({ partId }, "aucune OT en attente de cette pièce");
        return;
      }

      // Récupérer les infos de la pièce
      const [partInfo] = await db
        .select({ name: parts.name, reference: parts.reference })
        .from(parts)
        .where(eq(parts.id, partId));

      if (!partInfo) return;

      // Trouver le chef d'atelier
      const workshopManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'workshop_manager'));

      // Collecter les techniciens à notifier
      const technicianIds = new Set<number>();
      affectedWorkOrders.forEach(wo => {
        if (wo.technicianId) {
          technicianIds.add(wo.technicianId);
        }
      });

      const created: BroadcastableAlert[] = [];

      // Créer l'alerte pour le chef d'atelier
      for (const manager of workshopManagers) {
        const [alert] = await db.insert(alerts).values({
          userId: manager.id,
          title: 'Pièce reçue',
          message: `${quantityReceived} unité(s) de "${partInfo.name}" (${partInfo.reference || 'N/A'}) ont été reçues. ${affectedWorkOrders.length} OT en attente.`,
          type: 'inventory',
          priority: 'medium',
          link: `/inventory/parts`,
        }).returning();
        created.push(alert);
      }

      // Créer l'alerte pour chaque technicien concerné
      for (const techId of Array.from(technicianIds)) {
        const [alert] = await db.insert(alerts).values({
          userId: techId,
          title: 'Pièce disponible',
          message: `La pièce "${partInfo.name}" est maintenant disponible. Vous pouvez reprendre votre ordre de travail.`,
          type: 'work_order',
          priority: 'medium',
          link: `/maintenance/work-orders`,
        }).returning();
        created.push(alert);
      }

      // Couche 2 : sans cette trame, la cloche et le toast ne bougeaient pas.
      for (const alert of created) broadcastAlertCreated(alert);

      // Diffuser via WebSocket
      if ((global as any).broadcastUpdate) {
        (global as any).broadcastUpdate('part_received', {
          scope: workOrderStaffScope(),
          partId,
          quantityReceived,
          affectedWorkOrderIds: affectedWorkOrders.map(wo => wo.id),
        });
      }

      log.info({ partId, alerts: created.length }, "réception pièce notifiée");

    } catch (error) {
      log.error({ err: error, lineId, partId }, "notification de réception pièce");
    }
  }

  /**
   * Trouve les ordres de travail en "awaiting_parts" qui ont besoin de certaines pièces
   */
  private async findWorkOrdersAwaitingParts(partIds: number[]): Promise<Array<{
    id: number;
    title: string;
    technicianId: number | null;
    vehicleRegistration: string | null;
  }>> {
    if (partIds.length === 0) return [];

    // Récupérer les demandes de pièces liées à ces partIds
    const requirements = await db
      .select({
        workOrderId: partRequirements.workOrderId,
        partId: partRequirements.partId,
      })
      .from(partRequirements)
      .where(
        and(
          inArray(partRequirements.partId, partIds),
          inArray(partRequirements.status, ['pending', 'approved', 'ordered'])
        )
      );

    const workOrderIds = Array.from(new Set(requirements.map(r => r.workOrderId).filter((id): id is number => id !== null)));

    if (workOrderIds.length === 0) return [];

    // Récupérer les OT en attente de pièces
    const awaitingWorkOrders = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        technicianId: workOrders.technicianId,
        vehicleRegistration: workOrders.vehicleRegistration,
      })
      .from(workOrders)
      .where(
        and(
          inArray(workOrders.id, workOrderIds),
          eq(workOrders.status, 'awaiting_parts')
        )
      );

    return awaitingWorkOrders;
  }

  /**
   * Statistiques des commandes
   */
  async getOrderStatistics(dateFrom?: string, dateTo?: string): Promise<{
    totalOrders: number;
    totalAmount: number;
    totalSavings: number;
    averageDiscount: number;
    ordersByStatus: Record<string, number>;
  }> {
    let query = db.select().from(purchaseOrders);

    const conditions: any[] = [];
    if (dateFrom) conditions.push(gte(purchaseOrders.orderDate, dateFrom));
    if (dateTo) conditions.push(lte(purchaseOrders.orderDate, dateTo));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)!) as any;
    }

    const orders = await query;

    const totalOrders = orders.length;
    const totalAmount = orders.reduce((sum, o) => sum + this.num(o.totalAmountTTC), 0);
    const totalSavings = orders.reduce((sum, o) => sum + this.num(o.discountAmount), 0);
    const averageDiscount = orders.length > 0
      ? orders.reduce((sum, o) => sum + this.num(o.discountPercentage), 0) / orders.length
      : 0;

    const ordersByStatus: Record<string, number> = {};
    orders.forEach(o => {
      ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
    });

    return {
      totalOrders,
      totalAmount,
      totalSavings,
      averageDiscount,
      ordersByStatus,
    };
  }

  /**
   * Détection des commandes en retard de livraison
   * Identifie les commandes dont la date de livraison attendue est dépassée
   * et qui ne sont pas encore livrées/complétées
   */
  async getOverdueOrders(): Promise<Array<{
    id: number;
    orderNumber: string;
    supplierId: number;
    supplierName: string;
    expectedDeliveryDate: string;
    daysOverdue: number;
    status: string;
    totalAmountTTC: string;
    urgency: string;
  }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    console.log(`🚨 Vérification des commandes en retard - Date: ${todayStr}`);

    // Récupérer les commandes en retard
    const overdueOrders = await db
      .select({
        order: purchaseOrders,
        supplier: suppliers,
      })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          sql`${purchaseOrders.expectedDeliveryDate} < CURRENT_DATE`,
          sql`${purchaseOrders.status} NOT IN ('cancellation_requested', 'delivered', 'completed', 'cancelled')`
        )
      )
      .orderBy(purchaseOrders.expectedDeliveryDate);

    // Calculer les jours de retard
    const results = overdueOrders
      .filter(({ order }) => order.expectedDeliveryDate) // Filtrer les commandes sans date
      .map(({ order, supplier }) => {
        const deliveryDate = new Date(order.expectedDeliveryDate!);
        const diffTime = today.getTime() - deliveryDate.getTime();
        const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          supplierId: order.supplierId,
          supplierName: supplier?.name || 'Fournisseur inconnu',
          expectedDeliveryDate: order.expectedDeliveryDate!,
          daysOverdue,
          status: order.status,
          totalAmountTTC: order.totalAmountTTC || '0',
          urgency: order.urgency || 'medium',
        };
      });

    console.log(`📊 ${results.length} commande(s) en retard détectée(s)`);
    
    return results;
  }
}

export const procurementService = new ProcurementService();
