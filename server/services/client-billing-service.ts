import { publicClientColumns, publicClientInvoiceColumns } from "../lib/client-public-columns";
import { db } from "../db";
import { 
  clientInvoices,
  clientPayments,
  missions,
  missionPodFiles,
  clients,
  type ClientInvoice,
  type ClientPayment
} from "@shared/schema";
import { eq, desc, and, sql, gte, lte, inArray, gt, lt, ne } from "drizzle-orm";
import { CANCELLED_CLIENT_INVOICE_STATUS } from "@shared/constants/client-invoices";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("client-billing");

/**
 * Service Facturation Clients
 * 
 * Responsabilités:
 * - Génération factures clients depuis missions
 * - Gestion paiements clients
 * - Calcul TVA 19.25% automatique
 * - Rapports de facturation par client
 * - Suivi soldes et recouvrement
 */
export class ClientBillingService {
  private toDateIfValid(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private resolveMissionActualDeliveryDate(mission: typeof missions.$inferSelect): Date | null {
    const workflowData =
      typeof mission.workflowData === "object" && mission.workflowData !== null && !Array.isArray(mission.workflowData)
        ? (mission.workflowData as Record<string, unknown>)
        : null;
    const executionData =
      workflowData && typeof workflowData.execution === "object" && workflowData.execution !== null && !Array.isArray(workflowData.execution)
        ? (workflowData.execution as Record<string, unknown>)
        : null;

    const fromWorkflow = this.toDateIfValid(executionData?.actualDeliveryDate);
    const fromCompletedAt = this.toDateIfValid(mission.completedAt);
    const fromStatusFallback =
      (mission.status === "delivered" || mission.status === "completed")
        ? this.toDateIfValid(mission.updatedAt)
        : null;

    return fromWorkflow ?? fromCompletedAt ?? fromStatusFallback ?? null;
  }
  
  /**
   * Générer un numéro de facture automatique : FACT-YYYYMMDD-XXX
   * NOTE: This should only be called within a transaction that will insert the invoice
   */
  private async generateInvoiceNumberInTransaction(tx: any): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    
    // Lock ALL invoices for this date to prevent concurrent generation
    // Use advisory lock for the date to handle "first invoice of day" case
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice-${dateStr}`}))`);
    
    // Now safely find the last number
    const todayInvoices = await tx
      .select(publicClientInvoiceColumns)
      .from(clientInvoices)
      .where(sql`${clientInvoices.invoiceNumber} LIKE ${'FACT-' + dateStr + '-%'}`)
      .orderBy(desc(clientInvoices.invoiceNumber))
      .limit(1);
    
    let sequence = 1;
    if (todayInvoices.length > 0) {
      const lastNumber = todayInvoices[0].invoiceNumber;
      const lastSequence = parseInt(lastNumber.split('-').pop() || '0');
      sequence = lastSequence + 1;
    }
    
    const sequenceStr = sequence.toString().padStart(3, '0');
    return `FACT-${dateStr}-${sequenceStr}`;
  }
  
  /**
   * Générer une facture client depuis une mission
   */
  async generateInvoiceFromMission(missionId: number, invoiceData: {
    invoiceNumber?: string; // Optionnel - sera généré automatiquement si non fourni
    amount: number;
    dueDate: string;
    includeVAT: boolean;
    userId: number;
  }) {
    console.log(`Generating invoice for mission ${missionId}...`);
    
    // Wrap entire invoice creation in transaction to prevent duplicate numbers
    return await db.transaction(async (tx) => {
      // Récupérer la mission avec le client
      const [result] = await tx
        .select({
          mission: missions,
          client: publicClientColumns,
        })
        .from(missions)
        .leftJoin(clients, eq(missions.clientId, clients.id))
        .where(eq(missions.id, missionId))
        // Verrou de la ligne mission : le PUT du prix convenu la verrouille aussi, la facture et la correction se suivent.
        .for("update", { of: missions })
        .limit(1);

      if (!result || !result.mission) {
        throw new AppError(404, "Cette mission n'existe pas.");
      }

      if (!result.client) {
        throw new AppError(409, "Cette mission n'a pas de client : impossible de la facturer.");
      }

      const { mission, client } = result;

      // Pas de facture sans preuve de livraison : mission livrée ou clôturée, et au moins un fichier POD.
      if (mission.status !== "delivered" && mission.status !== "completed") {
        throw new AppError(409, "La mission n'est pas livrée : elle se facture une fois livrée ou clôturée.");
      }
      const [pod] = await tx
        .select({ id: missionPodFiles.id })
        .from(missionPodFiles)
        .where(eq(missionPodFiles.missionId, missionId))
        .limit(1);
      if (!pod) {
        throw new AppError(409, "Preuve de livraison manquante : déposez le POD de la mission avant de la facturer.");
      }
      const effectiveMissionDate =
        this.resolveMissionActualDeliveryDate(mission) ??
        this.toDateIfValid(mission.deliveryDate) ??
        this.toDateIfValid(mission.createdAt) ??
        new Date();

      // Générer numéro automatique si non fourni (dans la transaction)
      const invoiceNumber = invoiceData.invoiceNumber ||
        await this.generateInvoiceNumberInTransaction(tx);

      if (invoiceData.invoiceNumber) {
        const [taken] = await tx
          .select({ id: clientInvoices.id })
          .from(clientInvoices)
          .where(eq(clientInvoices.invoiceNumber, invoiceNumber))
          .limit(1);
        if (taken) {
          throw new AppError(409, `Le numéro de facture ${invoiceNumber} est déjà utilisé.`);
        }
      }

      // Montants arrondis au centime : TTC = HT + TVA exactement, comme stocké.
      const toCents = (value: number) => Math.round(value * 100) / 100;
      const amountHT = toCents(invoiceData.amount);
      const vatRate = invoiceData.includeVAT ? 19.25 : 0;
      const vatAmount = toCents((amountHT * vatRate) / 100);
      const amountTTC = toCents(amountHT + vatAmount);
      if (amountHT <= 0) {
        throw new AppError(400, "Le montant doit être d'au moins 0,01 FCFA.");
      }

      // Créer la facture (dans la même transaction)
      const [invoice] = await tx
        .insert(clientInvoices)
        .values({
          missionId,
          clientId: client.id,
          invoiceNumber,
          invoiceDate: new Date().toISOString().split('T')[0],
          dueDate: invoiceData.dueDate,
          amountHT: amountHT.toString(),
          vatRate: vatRate.toString(),
          vatAmount: vatAmount.toString(),
          amountTTC: amountTTC.toString(),
          balance: amountTTC.toString(),
          status: "pending",
          items: [{
            description: `Mission ${mission.deliveryAddress} - ${effectiveMissionDate.toLocaleDateString()}`,
            quantity: 1,
            unitPrice: amountHT,
            total: amountHT
          }],
          createdBy: invoiceData.userId,
        })
        .returning(publicClientInvoiceColumns);

      console.log(`Invoice ${invoice.invoiceNumber} created for client ${client.name}`);

      return {
        invoice,
        mission,
        client,
      };
    });
  }

  /**
   * Récupérer factures client avec filtres
   * Clients réels: MAERSK, CNPCC, AGL, SODECOTON
   */
  async getClientInvoices(filters?: {
    clientName?: string;
    clientId?: number;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    console.log("Fetching client invoices with filters:", filters);

    let query = db
      .select({
        invoice: publicClientInvoiceColumns,
        client: publicClientColumns,
        mission: missions,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id))
      .leftJoin(missions, eq(clientInvoices.missionId, missions.id));

    const conditions: any[] = [];

    if (filters?.clientId) {
      conditions.push(eq(clientInvoices.clientId, filters.clientId));
    }

    if (filters?.clientName) {
      // Récupérer le client par nom
      const [client] = await db
        .select(publicClientColumns)
        .from(clients)
        .where(eq(clients.name, filters.clientName))
        .limit(1);
      
      if (client) {
        conditions.push(eq(clientInvoices.clientId, client.id));
      }
    }

    if (filters?.status) {
      conditions.push(sql`${clientInvoices.status} = ${filters.status}`);
    }

    if (filters?.startDate && filters?.endDate) {
      conditions.push(
        gte(clientInvoices.invoiceDate, filters.startDate.toISOString().split('T')[0]),
        lte(clientInvoices.invoiceDate, filters.endDate.toISOString().split('T')[0])
      );
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = await query.orderBy(desc(clientInvoices.createdAt));

    const invoicesList = results.map(r => ({
      ...r.invoice,
      client: r.client,
      mission: r.mission,
    }));

    // Calculer statistiques
    const summary = {
      total: invoicesList.length,
      totalAmountHT: invoicesList.reduce((sum, inv) => sum + parseFloat(inv.amountHT || "0"), 0),
      totalVAT: invoicesList.reduce((sum, inv) => sum + parseFloat(inv.vatAmount || "0"), 0),
      totalAmountTTC: invoicesList.reduce((sum, inv) => sum + parseFloat(inv.amountTTC || "0"), 0),
      totalBalance: invoicesList.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0),
      totalPaid: invoicesList.reduce((sum, inv) => {
        const total = parseFloat(inv.amountTTC || "0");
        const balance = parseFloat(inv.balance || "0");
        return sum + (total - balance);
      }, 0),
      pending: invoicesList.filter(inv => inv.status === "pending").length,
      partial: invoicesList.filter(inv => inv.status === "partial").length,
      paid: invoicesList.filter(inv => inv.status === "paid").length,
      overdue: invoicesList.filter(inv => inv.status === "overdue").length,
    };

    console.log(`Found ${invoicesList.length} invoices`);

    return {
      invoices: invoicesList,
      summary,
    };
  }

  /**
   * Enregistrer un paiement client
   */
  /**
   * Passe en `overdue` les factures échues (échéance strictement passée) et non
   * soldées, en attente ou partiellement payées (CINV2). Idempotent : un second
   * passage n'écrit rien. Appelé par le cycle de fond (`server/scheduler.ts`).
   *
   * `asOf` : date métier (AAAA-MM-JJ), par défaut aujourd'hui à Douala.
   * `invoiceIds` : restreint le passage (tests sur base partagée).
   * Retourne les ids passés en retard.
   */
  async markOverdueInvoices(options: { asOf?: string; invoiceIds?: number[] } = {}): Promise<number[]> {
    const asOf = options.asOf ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(new Date());
    if (options.invoiceIds && options.invoiceIds.length === 0) return [];
    const conditions = [
      inArray(clientInvoices.status, ["pending", "partial"]),
      gt(clientInvoices.balance, "0"),
      lt(clientInvoices.dueDate, asOf),
    ];
    if (options.invoiceIds) conditions.push(inArray(clientInvoices.id, options.invoiceIds));

    const rows = await db
      .update(clientInvoices)
      .set({ status: "overdue", updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: clientInvoices.id });
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) log.info({ asOf, count: ids.length }, "factures client passées en retard");
    return ids;
  }

  async recordPayment(invoiceId: number, paymentData: {
    amount: number;
    paymentDate: string;
    paymentMethod: string;
    reference?: string;
    notes?: string;
    userId: number;
  }) {
    log.info({ invoiceId }, "enregistrement d'un paiement client");

    if (!Number.isFinite(paymentData.amount) || paymentData.amount <= 0) {
      throw new AppError(400, "Montant de paiement invalide.");
    }

    const reference = paymentData.reference?.trim() || null;

    // Verrou sur la facture : le solde est lu puis réécrit dans la même
    // transaction, deux paiements simultanés ne peuvent plus s'écraser.
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .select(publicClientInvoiceColumns)
        .from(clientInvoices)
        .where(eq(clientInvoices.id, invoiceId))
        .limit(1)
        .for("update");

      if (!invoice) {
        throw new AppError(404, "Cette facture n'existe plus.");
      }

      const currentBalance = parseFloat(invoice.balance);

      // Même référence et même montant : c'est la même saisie rejouée (retry
      // réseau, second onglet). On rend le paiement existant, sans doublon.
      if (reference) {
        const [sameReference] = await tx
          .select()
          .from(clientPayments)
          .where(and(eq(clientPayments.invoiceId, invoiceId), eq(clientPayments.reference, reference)))
          .limit(1);
        if (sameReference) {
          if (Math.abs(parseFloat(sameReference.amount) - paymentData.amount) < 0.005) {
            return {
              payment: sameReference,
              previousBalance: currentBalance,
              newBalance: currentBalance,
              status: invoice.status,
              replayed: true,
            };
          }
          throw new AppError(409, `La référence ${reference} est déjà utilisée pour un autre paiement de cette facture.`);
        }
      }

      if (invoice.status === "cancelled") {
        throw new AppError(409, "Cette facture est annulée : elle ne peut plus recevoir de paiement.");
      }

      if (paymentData.amount - currentBalance > 0.005) {
        throw new AppError(
          409,
          currentBalance <= 0
            ? "Cette facture est déjà soldée."
            : `Montant supérieur au solde restant (${currentBalance.toFixed(2)} FCFA).`
        );
      }

      // Arrondi au centime et borné à 0 : la tolérance de 0,005 ci-dessus laisserait un reste flottant négatif,
      // que le trigger client_invoices_issued_locked refuse (solde jamais sous zéro).
      const newBalance = Math.max(0, Math.round((currentBalance - paymentData.amount) * 100) / 100);

      // Déterminer le nouveau statut. Une facture en retard le reste tant
      // qu'elle n'est pas soldée (CINV2).
      let newStatus: "pending" | "partial" | "paid" | "overdue" = "pending";
      if (newBalance <= 0) {
        newStatus = "paid";
      } else if (invoice.status === "overdue") {
        newStatus = "overdue";
      } else if (newBalance < parseFloat(invoice.amountTTC)) {
        newStatus = "partial";
      }

      await tx
        .update(clientInvoices)
        .set({
          balance: newBalance.toString(),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(clientInvoices.id, invoiceId));

      const [payment] = await tx
        .insert(clientPayments)
        .values({
          invoiceId,
          amount: paymentData.amount.toString(),
          paymentDate: paymentData.paymentDate,
          paymentMethod: paymentData.paymentMethod as any,
          reference,
          notes: paymentData.notes,
          recordedBy: paymentData.userId,
        })
        .returning();

      return {
        payment,
        previousBalance: currentBalance,
        newBalance,
        status: newStatus,
        replayed: false,
      };
    });

    log.info(
      { invoiceId, amount: paymentData.amount, newBalance: result.newBalance, replayed: result.replayed },
      "paiement client enregistré"
    );

    return result;
  }

  /**
   * Récupérer une facture par ID avec tous les détails
   */
  async getInvoiceById(invoiceId: number) {
    console.log(`Fetching invoice ${invoiceId}...`);
    
    const [result] = await db
      .select({
        invoice: publicClientInvoiceColumns,
        client: publicClientColumns,
        mission: missions,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id))
      .leftJoin(missions, eq(clientInvoices.missionId, missions.id))
      .where(eq(clientInvoices.id, invoiceId));
    
    if (!result) {
      throw new AppError(404, "Facture non trouvée.");
    }
    
    // Récupérer les paiements associés
    const payments = await db
      .select()
      .from(clientPayments)
      .where(eq(clientPayments.invoiceId, invoiceId))
      .orderBy(desc(clientPayments.paymentDate));
    
    return {
      ...result.invoice,
      client: result.client,
      mission: result.mission,
      payments,
    };
  }

  /**
   * Rapport facturation par client
   */
  async getClientBillingReport(clientName: string, year: number, month?: number) {
    log.info({ clientName, year, month }, "Rapport de facturation client");

    // Récupérer le client
    const [client] = await db
      .select(publicClientColumns)
      .from(clients)
      .where(eq(clients.name, clientName))
      .limit(1);

    if (!client) {
      return {
        clientName,
        period: month ? `${month}/${year}` : year.toString(),
        totalInvoices: 0,
        totalAmountHT: 0,
        totalVAT: 0,
        totalAmountTTC: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        invoices: [],
      };
    }

    // Factures annulées exclues, comme au relevé de compte : ce n'est pas du chiffre facturé.
    const invoices = await db
      .select(publicClientInvoiceColumns)
      .from(clientInvoices)
      .where(and(eq(clientInvoices.clientId, client.id), ne(clientInvoices.status, CANCELLED_CLIENT_INVOICE_STATUS)));

    // Filtrer par période
    const filteredInvoices = invoices.filter(inv => {
      const invDate = new Date(inv.invoiceDate);
      return invDate.getFullYear() === year &&
             (month === undefined || invDate.getMonth() + 1 === month);
    });

    const report = {
      clientName: client.name,
      clientId: client.id,
      period: month ? `${month}/${year}` : year.toString(),
      totalInvoices: filteredInvoices.length,
      totalAmountHT: filteredInvoices.reduce((sum, inv) => sum + parseFloat(inv.amountHT || "0"), 0),
      totalVAT: filteredInvoices.reduce((sum, inv) => sum + parseFloat(inv.vatAmount || "0"), 0),
      totalAmountTTC: filteredInvoices.reduce((sum, inv) => sum + parseFloat(inv.amountTTC || "0"), 0),
      totalPaid: filteredInvoices.reduce((sum, inv) => {
        const total = parseFloat(inv.amountTTC || "0");
        const balance = parseFloat(inv.balance || "0");
        return sum + (total - balance);
      }, 0),
      totalOutstanding: filteredInvoices.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0),
      invoices: filteredInvoices,
    };

    log.debug({ invoices: report.totalInvoices }, "rapport de facturation client généré");

    return report;
  }

  /**
   * Obtenir les paiements d'une facture
   */
  async getInvoicePayments(invoiceId: number) {
    console.log(`Fetching payments for invoice ${invoiceId}...`);

    const payments = await db
      .select()
      .from(clientPayments)
      .where(eq(clientPayments.invoiceId, invoiceId))
      .orderBy(desc(clientPayments.paymentDate));

    const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

    log.debug({ invoiceId, payments: payments.length }, "paiements de la facture client lus");

    return {
      payments,
      totalPaid,
    };
  }

  /**
   * Statistiques globales de facturation
   */
  async getBillingStatistics() {
    console.log("Calculating global billing statistics...");

    // Récupérer toutes les factures
    const allInvoices = await db
      .select({
        invoice: publicClientInvoiceColumns,
        client: publicClientColumns,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id));

    // Calculer les totaux globaux
    const totalInvoices = allInvoices.length;
    const totalAmountHT = allInvoices.reduce((sum, r) => sum + parseFloat(r.invoice.amountHT || "0"), 0);
    const totalAmountTTC = allInvoices.reduce((sum, r) => sum + parseFloat(r.invoice.amountTTC || "0"), 0);
    const totalBalance = allInvoices.reduce((sum, r) => sum + parseFloat(r.invoice.balance || "0"), 0);
    const totalPaid = totalAmountTTC - totalBalance;

    // Statistiques par statut
    const byStatus = [
      {
        status: "pending",
        count: allInvoices.filter(r => r.invoice.status === "pending").length,
        totalAmountTTC: allInvoices.filter(r => r.invoice.status === "pending").reduce((sum, r) => sum + parseFloat(r.invoice.amountTTC || "0"), 0).toString(),
        totalBalance: allInvoices.filter(r => r.invoice.status === "pending").reduce((sum, r) => sum + parseFloat(r.invoice.balance || "0"), 0).toString(),
      },
      {
        status: "partial",
        count: allInvoices.filter(r => r.invoice.status === "partial").length,
        totalAmountTTC: allInvoices.filter(r => r.invoice.status === "partial").reduce((sum, r) => sum + parseFloat(r.invoice.amountTTC || "0"), 0).toString(),
        totalBalance: allInvoices.filter(r => r.invoice.status === "partial").reduce((sum, r) => sum + parseFloat(r.invoice.balance || "0"), 0).toString(),
      },
      {
        status: "paid",
        count: allInvoices.filter(r => r.invoice.status === "paid").length,
        totalAmountTTC: allInvoices.filter(r => r.invoice.status === "paid").reduce((sum, r) => sum + parseFloat(r.invoice.amountTTC || "0"), 0).toString(),
        totalBalance: allInvoices.filter(r => r.invoice.status === "paid").reduce((sum, r) => sum + parseFloat(r.invoice.balance || "0"), 0).toString(),
      },
    ];

    // Statistiques par client
    const clientsMap = new Map<number, {
      clientName: string;
      totalInvoices: number;
      totalAmountTTC: number;
      totalBalance: number;
      totalPaid: number;
    }>();

    allInvoices.forEach(r => {
      if (!r.client) return;
      
      const clientId = r.client.id;
      const existing = clientsMap.get(clientId);
      const amountTTC = parseFloat(r.invoice.amountTTC || "0");
      const balance = parseFloat(r.invoice.balance || "0");
      const paid = amountTTC - balance;

      if (existing) {
        existing.totalInvoices++;
        existing.totalAmountTTC += amountTTC;
        existing.totalBalance += balance;
        existing.totalPaid += paid;
      } else {
        clientsMap.set(clientId, {
          clientName: r.client.name,
          totalInvoices: 1,
          totalAmountTTC: amountTTC,
          totalBalance: balance,
          totalPaid: paid,
        });
      }
    });

    const byClient = Array.from(clientsMap.values()).map(c => ({
      clientName: c.clientName,
      totalInvoices: c.totalInvoices,
      totalAmountTTC: c.totalAmountTTC.toString(),
      totalPaid: c.totalPaid.toString(),
      totalBalance: c.totalBalance.toString(),
    }));

    const stats = {
      totalInvoices,
      totalAmountHT,
      totalAmountTTC,
      totalPaid,
      totalBalance,
      byStatus,
      byClient,
    };

    log.debug({ invoices: totalInvoices }, "statistiques de facturation client calculées");

    return stats;
  }
}

export const clientBillingService = new ClientBillingService();
