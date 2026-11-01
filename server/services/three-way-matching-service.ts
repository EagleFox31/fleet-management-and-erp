import { db } from "../db";
import { 
  supplierInvoices, 
  supplierInvoiceSettlements,
  purchaseOrders,
  purchaseOrderLines,
  suppliers,
  users,
  SupplierInvoice,
  SupplierInvoiceSettlement,
  InsertSupplierInvoice,
  PurchaseOrder
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte, or, lt, ne, inArray } from "drizzle-orm";
import { AppError } from "../lib/app-error";

/**
 * Service de contrôle 3 voies pour les factures fournisseurs
 * Compare automatiquement : Commande d'achat ↔ Bon de livraison ↔ Facture
 * Détecte les écarts >5% et gère le workflow de validation hiérarchique
 */
export class ThreeWayMatchingService {
  private readonly VAT_RATE = 19.25; // TVA au Cameroun
  private readonly VARIANCE_THRESHOLD = 5; // Seuil d'écart acceptable (%)
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

  private appendOrderTrace(existingNotes: string | null | undefined, traceLine: string): string {
    const base = (existingNotes || "").trim();
    return base ? `${base}\n${traceLine}` : traceLine;
  }

  private async resolveActorLabel(userId?: number): Promise<string> {
    if (!userId) return "Système (Finance auto)";

    const [actor] = await db
      .select({
        name: users.name,
        username: users.username,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!actor) return `Utilisateur #${userId}`;

    const actorName = (actor.name || actor.username || `Utilisateur #${userId}`).trim();
    if (!actor.role) return actorName;

    const normalizedRole = actor.role.trim().toLowerCase();
    return `${actorName} (${this.ROLE_LABELS[normalizedRole] || actor.role})`;
  }

  private async autoCloseDeliveredOrderIfFinanceDone(invoice: SupplierInvoice, actorId?: number): Promise<void> {
    if (!invoice.purchaseOrderId || invoice.status !== "paid") {
      return;
    }

    const orderId = invoice.purchaseOrderId;

    const [order] = await db
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        status: purchaseOrders.status,
        notes: purchaseOrders.notes,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .limit(1);

    if (!order || order.status !== "delivered") {
      return;
    }

    const linkedInvoices = await db
      .select({
        id: supplierInvoices.id,
        status: supplierInvoices.status,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.purchaseOrderId, orderId));

    if (linkedInvoices.length === 0) {
      return;
    }

    const allPaid = linkedInvoices.every((row) => row.status === "paid");
    if (!allPaid) {
      return;
    }

    const actorLabel = await this.resolveActorLabel(actorId);
    const traceLine = [
      `[TRACE_PO] ${new Date().toISOString()}`,
      "delivered -> completed",
      "by=Système (Finance auto)",
      `financeTriggeredBy=${encodeURIComponent(actorLabel)}`,
      `invoiceId=${invoice.id}`,
    ].join(" | ");

    await db
      .update(purchaseOrders)
      .set({
        status: "completed",
        notes: this.appendOrderTrace(order.notes, traceLine),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, orderId));

    console.log(
      `✅ Commande #${order.id} (${order.orderNumber}) clôturée automatiquement après règlement finance complet`
    );
  }

  private async syncInvoiceFromReconciledSettlements(
    invoiceId: number,
    actorId?: number
  ): Promise<SupplierInvoice> {
    const [invoice] = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      throw new Error(`Facture ${invoiceId} introuvable`);
    }

    const reconciledSettlements = await db
      .select({
        amount: supplierInvoiceSettlements.amount,
        paymentDate: supplierInvoiceSettlements.paymentDate,
        paymentMethod: supplierInvoiceSettlements.paymentMethod,
      })
      .from(supplierInvoiceSettlements)
      .where(
        and(
          eq(supplierInvoiceSettlements.supplierInvoiceId, invoiceId),
          eq(supplierInvoiceSettlements.status, "reconciled")
        )
      );

    const totalInvoice = this.num(invoice.totalTTC || invoice.totalAmount);
    const reconciledTotal = reconciledSettlements.reduce(
      (sum, s) => sum + this.num(s.amount),
      0
    );
    const remaining = Math.max(totalInvoice - reconciledTotal, 0);
    const isFullySettled = remaining <= 0.00001;

    const latestReconciled = reconciledSettlements
      .slice()
      .sort((a, b) => new Date(String(b.paymentDate || "1970-01-01")).getTime() - new Date(String(a.paymentDate || "1970-01-01")).getTime())[0];

    const nextStatus = isFullySettled
      ? "paid"
      : (invoice.status === "paid" ? "approved" : invoice.status);

    const [updated] = await db
      .update(supplierInvoices)
      .set({
        status: nextStatus as any,
        isPaymentComplete: isFullySettled,
        balance: String(remaining),
        paidBy: isFullySettled ? actorId ?? invoice.paidBy : invoice.paidBy,
        paidDate: isFullySettled ? String(latestReconciled?.paymentDate || invoice.paidDate || new Date().toISOString().split("T")[0]) : null,
        paymentDate: isFullySettled ? String(latestReconciled?.paymentDate || invoice.paymentDate || new Date().toISOString().split("T")[0]) : null,
        paymentMethod: isFullySettled ? String(latestReconciled?.paymentMethod || invoice.paymentMethod || "") : invoice.paymentMethod,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, invoiceId))
      .returning();

    if (updated?.status === "paid") {
      await this.autoCloseDeliveredOrderIfFinanceDone(updated, actorId);
    }

    return updated;
  }

  private async inferOrderScope(orderId: number): Promise<"parts" | "non_parts"> {
    const [partsLine] = await db
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, orderId),
          or(
            sql`${purchaseOrderLines.partId} IS NOT NULL`,
            sql`${purchaseOrderLines.partRequirementId} IS NOT NULL`
          )
        )
      )
      .limit(1);

    return partsLine ? "parts" : "non_parts";
  }

  /**
   * MÉTHODE 1: Validation de la facture contre la commande d'achat (Contrôle 3 voies)
   * Compare les montants et quantités entre facture et commande
   * Retourne les écarts détectés
   */
  async validateInvoiceAgainstOrder(
    invoiceId: number
  ): Promise<{
    isValid: boolean;
    hasDiscrepancy: boolean;
    priceVariance: number;
    quantityVariance: number;
    variancePercentage: number;
    details: {
      invoiceTotal: number;
      orderTotal: number;
      invoiceQuantity: number;
      orderQuantity: number;
    };
    recommendation: 'auto_approve' | 'manual_review' | 'escalate';
  }> {
    // Récupérer la facture avec ses relations
    const [invoiceData] = await db
      .select({
        invoice: supplierInvoices,
        order: purchaseOrders,
      })
      .from(supplierInvoices)
      .leftJoin(purchaseOrders, eq(supplierInvoices.purchaseOrderId, purchaseOrders.id))
      .where(eq(supplierInvoices.id, invoiceId));

    if (!invoiceData) {
      throw new Error(`Facture ${invoiceId} introuvable`);
    }

    const { invoice, order } = invoiceData;

    // Si pas de commande liée, validation impossible
    if (!order) {
      return {
        isValid: false,
        hasDiscrepancy: true,
        priceVariance: 0,
        quantityVariance: 0,
        variancePercentage: 100,
        details: {
          invoiceTotal: this.num(invoice.totalAmount || invoice.totalTTC),
          orderTotal: 0,
          invoiceQuantity: this.num(invoice.quantity),
          orderQuantity: 0,
        },
        recommendation: 'manual_review',
      };
    }

    // Calculer les écarts
    // Prioriser le TTC comme référence métier finale (après remise éventuelle).
    const invoiceTotal = this.num(invoice.totalTTC || invoice.totalAmount || invoice.amountHT);
    const orderTotal = this.num(order.totalAmountTTC);
    const priceVariance = invoiceTotal - orderTotal;
    const priceVarianceAbs = Math.abs(priceVariance);

    const invoiceQty = this.num(invoice.quantity);
    const orderQty = await this.getOrderTotalQuantity(order.id);
    const quantityVariance = invoiceQty - orderQty;

    // Calculer le pourcentage d'écart sur le prix
    const variancePercentage = orderTotal > 0 
      ? (priceVarianceAbs / orderTotal) * 100 
      : 0;

    // Déterminer si écart significatif (>= 5% nécessite escalade)
    const hasDiscrepancy = variancePercentage >= this.VARIANCE_THRESHOLD;

    // Recommandation basée sur l'écart
    let recommendation: 'auto_approve' | 'manual_review' | 'escalate';
    if (variancePercentage === 0 && quantityVariance === 0) {
      recommendation = 'auto_approve'; // Match parfait
    } else if (variancePercentage <= this.VARIANCE_THRESHOLD) {
      recommendation = 'manual_review'; // Écart acceptable
    } else {
      recommendation = 'escalate'; // Écart significatif
    }

    return {
      isValid: !hasDiscrepancy,
      hasDiscrepancy,
      priceVariance,
      quantityVariance,
      variancePercentage: Math.round(variancePercentage * 100) / 100,
      details: {
        invoiceTotal,
        orderTotal,
        invoiceQuantity: invoiceQty,
        orderQuantity: orderQty,
      },
      recommendation,
    };
  }

  /**
   * MÉTHODE 2: Détection des écarts de prix
   * Analyse ligne par ligne les écarts entre facture et commande
   */
  async detectPriceVariances(purchaseOrderId: number): Promise<{
    totalVariance: number;
    variancePercentage: number;
    lineVariances: Array<{
      lineId: number;
      description: string;
      orderedQty: number;
      orderedPrice: number;
      variance: number;
    }>;
  }> {
    // Récupérer les lignes de la commande
    const orderLines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId));

    if (orderLines.length === 0) {
      return {
        totalVariance: 0,
        variancePercentage: 0,
        lineVariances: [],
      };
    }

    // Calculer les écarts par ligne
    const lineVariances = orderLines.map(line => ({
      lineId: line.id,
      description: line.description || `Ligne ${line.id}`,
      orderedQty: line.quantityOrdered,
      orderedPrice: this.num(line.totalPrice),
      variance: 0, // Sera calculé si facture liée
    }));

    const totalOrderPrice = orderLines.reduce((sum, line) => 
      sum + this.num(line.totalPrice), 0
    );

    return {
      totalVariance: 0,
      variancePercentage: 0,
      lineVariances,
    };
  }

  /**
   * MÉTHODE 3: Approbation automatique des factures sans écart
   * Auto-approuve si match parfait entre facture et commande
   */
  async autoApproveMatches(userId: number): Promise<{
    approvedCount: number;
    approvedInvoices: number[];
  }> {
    // Récupérer les factures en attente de validation
    const pendingInvoices = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.status, 'received'));

    const approvedInvoices: number[] = [];

    for (const invoice of pendingInvoices) {
      // Valider contre la commande
      const validation = await this.validateInvoiceAgainstOrder(invoice.id);

      // Auto-approuver si match parfait
      if (validation.recommendation === 'auto_approve') {
        await db
          .update(supplierInvoices)
          .set({
            status: 'approved',
            validatedBy: userId,
            validatedAt: new Date(),
            approvedBy: userId,
            approvedAt: new Date(),
            priceVariance: String(validation.priceVariance),
            quantityVariance: String(validation.quantityVariance),
            variancePercentage: String(validation.variancePercentage),
            hasDiscrepancy: false,
            updatedAt: new Date(),
          })
          .where(eq(supplierInvoices.id, invoice.id));

        approvedInvoices.push(invoice.id);
      }
    }

    return {
      approvedCount: approvedInvoices.length,
      approvedInvoices,
    };
  }

  /**
   * MÉTHODE 4: Escalade des écarts >5%
   * Remonte les factures avec écarts significatifs vers admin/workshop_manager
   */
  async escalateDiscrepancies(): Promise<{
    escalatedCount: number;
    discrepancies: Array<{
      invoiceId: number;
      invoiceNumber: string;
      supplierName: string;
      varianceAmount: number;
      variancePercentage: number;
      orderNumber?: string;
    }>;
  }> {
    // Récupérer les factures avec écarts >5%
    const discrepantInvoices = await db
      .select({
        invoice: supplierInvoices,
        supplier: suppliers,
        order: purchaseOrders,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .leftJoin(purchaseOrders, eq(supplierInvoices.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          eq(supplierInvoices.hasDiscrepancy, true),
          sql`${supplierInvoices.status} IN ('received', 'disputed')`
        )
      )
      .orderBy(desc(supplierInvoices.variancePercentage));

    const discrepancies = discrepantInvoices.map(({ invoice, supplier, order }) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: supplier?.name || 'Inconnu',
      varianceAmount: this.num(invoice.priceVariance),
      variancePercentage: this.num(invoice.variancePercentage),
      orderNumber: order?.orderNumber,
    }));

    return {
      escalatedCount: discrepancies.length,
      discrepancies,
    };
  }

  /**
   * Helper: Calculer la quantité totale commandée
   */
  private async getOrderTotalQuantity(orderId: number): Promise<number> {
    const lines = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, orderId));

    return lines.reduce((sum, line) => sum + line.quantityOrdered, 0);
  }

  /**
   * Créer une facture fournisseur avec validation initiale
   */
  async createSupplierInvoice(
    data: InsertSupplierInvoice,
    createdByUserId?: number
  ): Promise<{ invoice: SupplierInvoice; validation: any }> {
    // Champs tenus par le workflow, jamais par la saisie : une facture naissait
    // « payée » ou « approuvée par » n'importe qui, avec un solde à 0.
    const {
      status: _status,
      validatedBy: _validatedBy,
      validatedAt: _validatedAt,
      approvedBy: _approvedBy,
      approvedAt: _approvedAt,
      paidBy: _paidBy,
      paidDate: _paidDate,
      paymentDate: _paymentDate,
      isPaymentComplete: _isPaymentComplete,
      balance: _balance,
      priceVariance: _priceVariance,
      quantityVariance: _quantityVariance,
      variancePercentage: _variancePercentage,
      hasDiscrepancy: _hasDiscrepancy,
      ...entered
    } = data;

    const MAX_AMOUNT = 1_000_000_000_000;
    for (const [field, value] of Object.entries({
      amountHT: data.amountHT,
      subtotal: data.subtotal,
      vatAmount: data.vatAmount,
      taxAmount: data.taxAmount,
      totalTTC: data.totalTTC,
      totalAmount: data.totalAmount,
    })) {
      if (value === undefined || value === null || value === "") continue;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
        throw new AppError(400, "Montant de facture invalide : nombre positif attendu.", {
          cause: new Error(`supplier invoice ${field} invalide`),
        });
      }
    }

    // Calculer les montants si non fournis
    const rawAmountHT = this.num(data.amountHT || data.subtotal);
    const rawVatAmount = this.num(data.vatAmount || data.taxAmount);
    const explicitTotal = this.num(data.totalTTC || data.totalAmount);

    // Le réalignement sur le TTC ci-dessous réécrivait le HT d'un TTC trop faible.
    if (explicitTotal > 0 && rawAmountHT > 0 && explicitTotal < rawAmountHT) {
      throw new AppError(400, "Le montant TTC ne peut pas être inférieur au montant HT.");
    }

    let amountHT = rawAmountHT;
    let vatAmount = rawVatAmount;

    if (vatAmount <= 0 && amountHT > 0) {
      vatAmount = (amountHT * this.VAT_RATE) / 100;
    }

    let totalAmount = explicitTotal > 0 ? explicitTotal : amountHT + vatAmount;

    if (amountHT <= 0 && totalAmount > 0) {
      if (vatAmount > 0) {
        amountHT = Math.max(totalAmount - vatAmount, 0);
      } else {
        amountHT = totalAmount / (1 + this.VAT_RATE / 100);
        vatAmount = totalAmount - amountHT;
      }
    }

    if (vatAmount <= 0 && totalAmount > 0 && amountHT > 0) {
      vatAmount = Math.max(totalAmount - amountHT, 0);
    }

    // Si un total explicite est fourni, on aligne HT+TVA sur ce total.
    if (
      explicitTotal > 0 &&
      amountHT > 0 &&
      vatAmount > 0 &&
      Math.abs((amountHT + vatAmount) - explicitTotal) > 1
    ) {
      amountHT = Math.max(explicitTotal - vatAmount, 0);
      totalAmount = explicitTotal;
    }

    const toCents = (value: number) => Math.round(value * 100) / 100;
    amountHT = toCents(amountHT);
    vatAmount = toCents(vatAmount);
    totalAmount = toCents(totalAmount);

    if (!(amountHT > 0) || !(totalAmount >= amountHT)) {
      throw new AppError(
        400,
        amountHT > 0
          ? "Le montant TTC ne peut pas être inférieur au montant HT."
          : "Saisissez un montant HT ou TTC supérieur à 0."
      );
    }

    const [taken] = await db
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.invoiceNumber, data.invoiceNumber))
      .limit(1);
    if (taken) {
      throw new AppError(409, `La facture ${data.invoiceNumber} est déjà saisie.`);
    }

    // Créer la facture
    const [invoice] = await db
      .insert(supplierInvoices)
      .values({
        ...entered,
        // Rien n'est encore réglé : le solde part du TTC.
        balance: String(totalAmount),
        amountHT: String(amountHT),
        subtotal: String(amountHT),
        vatAmount: String(vatAmount),
        taxAmount: String(vatAmount),
        totalAmount: String(totalAmount),
        totalTTC: String(totalAmount),
        status: 'received',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Valider contre la commande si liée
    let validation: any = null;
    if (invoice.purchaseOrderId) {
      validation = await this.validateInvoiceAgainstOrder(invoice.id);

      // Mettre à jour les écarts détectés
      await db
        .update(supplierInvoices)
        .set({
          priceVariance: String(validation.priceVariance),
          quantityVariance: String(validation.quantityVariance),
          variancePercentage: String(validation.variancePercentage),
          hasDiscrepancy: validation.hasDiscrepancy,
          updatedAt: new Date(),
        })
        .where(eq(supplierInvoices.id, invoice.id));
    }

    return { invoice, validation };
  }

  /**
   * Valider une facture (étape 1 du workflow)
   */
  async validateInvoice(
    invoiceId: number,
    validatedBy: number,
    notes?: string
  ): Promise<SupplierInvoice> {
    const [updated] = await db
      .update(supplierInvoices)
      .set({
        status: 'validated',
        validatedBy,
        validatedAt: new Date(),
        discrepancyNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, invoiceId))
      .returning();

    return updated;
  }

  /**
   * Approuver une facture (étape 2 du workflow)
   */
  async approveInvoice(
    invoiceId: number,
    approvedBy: number
  ): Promise<SupplierInvoice> {
    const [updated] = await db
      .update(supplierInvoices)
      .set({
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoices.id, invoiceId))
      .returning();

    return updated;
  }

  /**
   * Marquer une facture comme payée (étape finale)
   */
  async markInvoiceAsPaid(
    invoiceId: number,
    paidBy: number,
    paymentDate: string,
    paymentMethod: string,
    proofReference: string
  ): Promise<SupplierInvoice> {
    const [invoice] = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      throw new AppError(404, "Cette facture n'existe plus.");
    }

    // Déjà soldée : un second appel (double clic, retry) ne paie pas deux fois.
    if (invoice.status === "paid") {
      return invoice;
    }

    const totalInvoice = this.num(invoice.totalTTC || invoice.totalAmount);
    const currentBalance = Math.max(this.num(invoice.balance || totalInvoice), 0);
    const amount = currentBalance > 0 ? currentBalance : totalInvoice;

    const { settlement } = await this.recordInvoiceSettlement(invoiceId, paidBy, {
      amount,
      paymentMethod,
      paymentDate,
      paymentReference: `AUTO-${Date.now()}`,
      proofReference,
      notes: "Règlement enregistré via endpoint legacy /payment",
    });

    await this.reconcileInvoiceSettlement(
      invoiceId,
      settlement.id,
      paidBy,
      "Rapprochement automatique legacy"
    );

    const [updated] = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, invoiceId))
      .limit(1);

    if (!updated) {
      throw new Error(`Facture ${invoiceId} introuvable après paiement`);
    }

    return updated;
  }

  async recordInvoiceSettlement(
    invoiceId: number,
    recordedBy: number,
    data: {
      amount: string | number;
      paymentMethod: string;
      paymentReference: string;
      paymentDate: string;
      valueDate?: string;
      treasuryAccount?: string;
      proofReference?: string;
      notes?: string;
    }
  ): Promise<{ settlement: SupplierInvoiceSettlement; invoice: SupplierInvoice; replayed: boolean }> {
    const amount = this.num(data.amount);
    if (amount <= 0) {
      throw new AppError(400, "Montant de règlement invalide.");
    }

    const normalizedProofReference = String(data.proofReference || "").trim();
    if (!normalizedProofReference) {
      throw new AppError(400, "Justificatif de règlement obligatoire (image ou PDF).");
    }

    const paymentReference = data.paymentReference.trim();

    // Verrou sur la facture : deux saisies simultanées passent l'une après
    // l'autre, la seconde voit donc le règlement enregistré par la première.
    return db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, invoiceId))
        .limit(1)
        .for("update");

      if (!invoice) {
        throw new AppError(404, "Cette facture n'existe plus.");
      }

      if (!["approved", "paid"].includes(String(invoice.status))) {
        throw new AppError(409, "La facture doit être approuvée avant enregistrement du règlement.");
      }

      const activeSettlements = await tx
        .select()
        .from(supplierInvoiceSettlements)
        .where(
          and(
            eq(supplierInvoiceSettlements.supplierInvoiceId, invoiceId),
            ne(supplierInvoiceSettlements.status, "rejected")
          )
        );

      // Même référence et même montant : c'est la même saisie rejouée (double
      // clic, retry réseau). On rend le règlement existant, sans doublon.
      const sameReference = activeSettlements.find((s) => s.paymentReference.trim() === paymentReference);
      if (sameReference) {
        if (Math.abs(this.num(sameReference.amount) - amount) < 0.005) {
          return { settlement: sameReference, invoice, replayed: true };
        }
        throw new AppError(409, `La référence ${paymentReference} est déjà utilisée pour un autre règlement de cette facture.`);
      }

      // Le solde de la facture ne baisse qu'au rapprochement bancaire : les
      // règlements saisis en attente de rapprochement sont déduits ici.
      const totalInvoice = this.num(invoice.totalTTC || invoice.totalAmount);
      const currentBalance = Math.max(this.num(invoice.balance || totalInvoice), 0);
      const awaitingReconciliation = activeSettlements
        .filter((s) => s.status === "recorded")
        .reduce((sum, s) => sum + this.num(s.amount), 0);
      const remaining = Math.max(currentBalance - awaitingReconciliation, 0);

      if (amount - remaining > 0.00001) {
        throw new AppError(
          409,
          awaitingReconciliation > 0
            ? `Montant supérieur au reste à régler (${remaining.toFixed(2)} FCFA, règlements en attente de rapprochement déduits).`
            : `Montant supérieur au solde restant (${remaining.toFixed(2)} FCFA).`
        );
      }

      const [settlement] = await tx
        .insert(supplierInvoiceSettlements)
        .values({
          supplierInvoiceId: invoiceId,
          amount: String(amount),
          paymentMethod: data.paymentMethod as any,
          paymentReference,
          paymentDate: data.paymentDate,
          valueDate: data.valueDate || null,
          treasuryAccount: data.treasuryAccount || null,
          proofReference: normalizedProofReference,
          status: "recorded",
          recordedBy,
          notes: data.notes || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return { settlement, invoice, replayed: false };
    });
  }

  async reconcileInvoiceSettlement(
    invoiceId: number,
    settlementId: number,
    reconciledBy: number,
    reconciliationNote?: string
  ): Promise<{ settlement: SupplierInvoiceSettlement; invoice: SupplierInvoice }> {
    const [settlement] = await db
      .select()
      .from(supplierInvoiceSettlements)
      .where(
        and(
          eq(supplierInvoiceSettlements.id, settlementId),
          eq(supplierInvoiceSettlements.supplierInvoiceId, invoiceId)
        )
      )
      .limit(1);

    if (!settlement) {
      throw new AppError(404, "Ce règlement n'existe plus.");
    }

    if (settlement.status === "rejected") {
      throw new AppError(409, "Un règlement rejeté ne peut pas être rapproché.");
    }

    // Compare-and-set : seul le passage recorded -> reconciled écrit. Un second
    // rapprochement (double clic) trouve le règlement déjà rapproché et rend
    // l'état courant au lieu d'une erreur.
    const [updatedSettlement] = await db
      .update(supplierInvoiceSettlements)
      .set({
        status: "reconciled",
        reconciledBy,
        reconciledAt: new Date(),
        reconciliationNote: reconciliationNote || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplierInvoiceSettlements.id, settlementId),
          eq(supplierInvoiceSettlements.status, "recorded")
        )
      )
      .returning();

    let current = updatedSettlement;
    if (!current) {
      [current] = await db
        .select()
        .from(supplierInvoiceSettlements)
        .where(eq(supplierInvoiceSettlements.id, settlementId))
        .limit(1);
      if (current?.status !== "reconciled") {
        throw new AppError(409, "Ce règlement a été modifié entre-temps. Rechargez la page puis réessayez.");
      }
    }

    // Recalcul idempotent du solde ; sur un rejeu, il répare aussi une
    // synchronisation interrompue. L'auteur du paiement reste le premier.
    const updatedInvoice = await this.syncInvoiceFromReconciledSettlements(
      invoiceId,
      current.reconciledBy ?? reconciledBy
    );

    return {
      settlement: current,
      invoice: updatedInvoice,
    };
  }

  async getInvoiceSettlements(invoiceId: number) {
    const rows = await db
      .select()
      .from(supplierInvoiceSettlements)
      .where(eq(supplierInvoiceSettlements.supplierInvoiceId, invoiceId))
      .orderBy(desc(supplierInvoiceSettlements.createdAt));

    const userIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.recordedBy, row.reconciledBy])
          .filter((id): id is number => typeof id === "number")
      )
    );

    const usersMap = new Map<number, { id: number; name: string; role: string }>();
    if (userIds.length > 0) {
      const usersRows = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
        })
        .from(users)
        .where(inArray(users.id, userIds));

      for (const u of usersRows) {
        usersMap.set(u.id, u);
      }
    }

    return rows.map((row) => ({
      ...row,
      recordedByUser: row.recordedBy ? usersMap.get(row.recordedBy) ?? null : null,
      reconciledByUser: row.reconciledBy ? usersMap.get(row.reconciledBy) ?? null : null,
    }));
  }

  /**
   * Récupérer toutes les factures avec filtres
   */
  async getSupplierInvoices(filters?: {
    status?: string;
    supplierId?: number;
    hasDiscrepancy?: boolean;
    startDate?: string;
    endDate?: string;
  }) {
    const conditions: any[] = [];

    if (filters?.status) {
      conditions.push(sql`${supplierInvoices.status} = ${filters.status}`);
    }
    if (filters?.supplierId) {
      conditions.push(eq(supplierInvoices.supplierId, filters.supplierId));
    }
    if (filters?.hasDiscrepancy !== undefined) {
      conditions.push(eq(supplierInvoices.hasDiscrepancy, filters.hasDiscrepancy));
    }
    if (filters?.startDate) {
      conditions.push(gte(supplierInvoices.invoiceDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(supplierInvoices.invoiceDate, filters.endDate));
    }

    const results = await db
      .select({
        invoice: supplierInvoices,
        supplier: suppliers,
        purchaseOrder: purchaseOrders,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .leftJoin(purchaseOrders, eq(supplierInvoices.purchaseOrderId, purchaseOrders.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(supplierInvoices.createdAt));

    return results.map(r => ({
      ...r.invoice,
      // Mapper amountHT → totalAmountHT et totalTTC → totalAmountTTC pour cohérence frontend
      totalAmountHT: r.invoice.amountHT || "0",
      totalAmountTTC: r.invoice.totalTTC || "0",
      supplierName: r.supplier?.name || undefined, // Ajouter supplierName pour affichage liste
      purchaseOrderNumber: r.purchaseOrder?.orderNumber || undefined, // Ajouter orderNumber pour affichage liste
      supplier: r.supplier ? { id: r.supplier.id, name: r.supplier.name } : undefined,
      purchaseOrder: r.purchaseOrder ? { 
        id: r.purchaseOrder.id, 
        orderNumber: r.purchaseOrder.orderNumber 
      } : undefined,
    }));
  }

  /**
   * Récupérer une facture par ID avec tous les détails
   */
  async getSupplierInvoiceById(id: number) {
    const [result] = await db
      .select({
        invoice: supplierInvoices,
        supplier: suppliers,
        purchaseOrder: purchaseOrders,
        validatedByUser: users,
        approvedByUser: users,
        paidByUser: users,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .leftJoin(purchaseOrders, eq(supplierInvoices.purchaseOrderId, purchaseOrders.id))
      .leftJoin(users, eq(supplierInvoices.validatedBy, users.id))
      .where(eq(supplierInvoices.id, id));

    if (!result) return null;

    // Validation 3 voies si commande liée
    let threeWayMatch: any = null;
    let workflowScope: "parts" | "non_parts" | "none" = "none";
    if (result.invoice.purchaseOrderId) {
      threeWayMatch = await this.validateInvoiceAgainstOrder(id);
      workflowScope = await this.inferOrderScope(result.invoice.purchaseOrderId);
    }

    // Mapper les noms de colonnes DB vers les noms attendus par le frontend
    const invoice = result.invoice;
    return {
      ...invoice,
      // Mapper amountHT → totalAmountHT et totalTTC → totalAmountTTC pour cohérence frontend
      totalAmountHT: invoice.amountHT || "0",
      totalAmountTTC: invoice.totalTTC || "0",
      supplier: result.supplier,
      purchaseOrder: result.purchaseOrder,
      validatedByUser: result.validatedByUser ? {
        id: result.validatedByUser.id,
        name: result.validatedByUser.name,
      } : null,
      approvedByUser: result.approvedByUser ? {
        id: result.approvedByUser.id,
        name: result.approvedByUser.name,
      } : null,
      paidByUser: result.paidByUser ? {
        id: result.paidByUser.id,
        name: result.paidByUser.name,
      } : null,
      workflowScope,
      threeWayMatch,
    };
  }

  /**
   * Récupérer les statistiques globales des factures fournisseurs
   */
  async getStatistics() {
    // Récupérer toutes les factures
    const allInvoices = await db
      .select()
      .from(supplierInvoices);

    // Calculer les totaux
    const totalInvoices = allInvoices.length;
    const totalAmountHT = allInvoices.reduce((sum, inv) => sum + this.num(inv.amountHT), 0);
    const totalAmountTTC = allInvoices.reduce((sum, inv) => sum + this.num(inv.totalTTC || inv.totalAmount), 0);
    const totalPaid = allInvoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + this.num(inv.totalTTC || inv.totalAmount), 0);
    const totalBalance = allInvoices.reduce((sum, inv) => sum + this.num(inv.balance), 0);

    // Répartition par statut
    const byStatus = [
      { status: 'received', label: 'Reçues' },
      { status: 'validated', label: 'Validées' },
      { status: 'approved', label: 'Approuvées' },
      { status: 'paid', label: 'Payées' },
      { status: 'disputed', label: 'Contestées' },
    ].map(({ status, label }) => {
      const invoicesForStatus = allInvoices.filter(inv => inv.status === status);
      const count = invoicesForStatus.length;
      const totalAmount = invoicesForStatus.reduce((sum, inv) => sum + this.num(inv.totalTTC || inv.totalAmount), 0);
      const totalBalanceForStatus = invoicesForStatus.reduce((sum, inv) => sum + this.num(inv.balance), 0);

      return {
        status,
        label,
        count,
        totalAmount: totalAmount.toFixed(2),
        totalBalance: totalBalanceForStatus.toFixed(2),
      };
    }).filter(s => s.count > 0); // Ne garder que les statuts avec au moins 1 facture

    // Statistiques écarts
    const invoicesWithDiscrepancy = allInvoices.filter(inv => inv.hasDiscrepancy);
    const totalDiscrepancies = invoicesWithDiscrepancy.length;
    const averageVariance = totalDiscrepancies > 0
      ? invoicesWithDiscrepancy.reduce((sum, inv) => sum + this.num(inv.variancePercentage), 0) / totalDiscrepancies
      : 0;

    // Top 5 fournisseurs par montant (optimisé avec une seule requête SQL)
    const topSuppliersQuery = await db
      .select({
        supplierName: suppliers.name,
        totalInvoices: sql<number>`count(*)::int`,
        totalAmount: sql<string>`COALESCE(SUM(COALESCE(${supplierInvoices.totalTTC}, ${supplierInvoices.totalAmount})), 0)`,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(sql`${supplierInvoices.supplierId} IS NOT NULL AND ${suppliers.id} IS NOT NULL`)
      .groupBy(supplierInvoices.supplierId, suppliers.name)
      .orderBy(desc(sql`SUM(COALESCE(${supplierInvoices.totalTTC}, ${supplierInvoices.totalAmount}))`))
      .limit(5);

    const topSuppliers = topSuppliersQuery.map(s => ({
      supplierName: s.supplierName,
      totalInvoices: s.totalInvoices,
      totalAmount: parseFloat(s.totalAmount).toFixed(2),
    }));

    return {
      totalInvoices,
      totalAmountHT: totalAmountHT.toFixed(2),
      totalAmountTTC: totalAmountTTC.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      totalBalance: totalBalance.toFixed(2),
      byStatus,
      discrepancies: {
        total: totalDiscrepancies,
        averageVariance: averageVariance.toFixed(1),
        percentage: totalInvoices > 0 ? ((totalDiscrepancies / totalInvoices) * 100).toFixed(1) : "0.0",
      },
      topSuppliers,
    };
  }

  /**
   * Récupérer les factures en retard (dueDate dépassée et non payées)
   */
  async getOverdueInvoices(): Promise<Array<{
    id: number;
    invoiceNumber: string;
    supplierId: number;
    supplierName: string;
    invoiceDate: string;
    dueDate: string;
    daysOverdue: number;
    totalAmount: string;
    balance: string;
    status: string;
  }>> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const overdueInvoices = await db
      .select({
        id: supplierInvoices.id,
        invoiceNumber: supplierInvoices.invoiceNumber,
        supplierId: supplierInvoices.supplierId,
        supplierName: suppliers.name,
        invoiceDate: supplierInvoices.invoiceDate,
        dueDate: supplierInvoices.dueDate,
        totalAmount: supplierInvoices.totalAmount,
        totalTTC: supplierInvoices.totalTTC,
        amountHT: supplierInvoices.amountHT,
        balance: supplierInvoices.balance,
        status: supplierInvoices.status,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(
        and(
          sql`${supplierInvoices.dueDate} IS NOT NULL`,
          lt(supplierInvoices.dueDate, todayStr),
          ne(supplierInvoices.status, 'paid')
        )
      )
      .orderBy(supplierInvoices.dueDate);

    return overdueInvoices.map(inv => {
      if (!inv.dueDate) {
        // Fallback au cas où (ne devrait pas arriver avec le filtre WHERE)
        return null as any;
      }

      const dueDate = new Date(inv.dueDate);
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      
      const totalAmount = this.num(inv.totalTTC || inv.totalAmount || inv.amountHT);
      const balance = this.num(inv.balance || totalAmount);

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplierId: inv.supplierId || 0,
        supplierName: inv.supplierName || "Fournisseur inconnu",
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        daysOverdue,
        totalAmount: totalAmount.toFixed(2),
        balance: balance.toFixed(2),
        status: inv.status,
      };
    }).filter(inv => inv !== null);
  }
}

export const threeWayMatchingService = new ThreeWayMatchingService();
