import { db } from "../db";
import { supplierInvoices, suppliers, parts } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { DEFAULT_VAT_RATE, calculateVAT as computeVAT } from "./vat-calculation";

/**
 * Service Factures & TVA
 * 
 * Responsabilités :
 * - Synthèse factures fournisseurs (96 factures importées)
 * - Calcul TVA automatique 19.25%
 * - Statistiques par famille (pneus, batteries, huiles, etc.)
 * - Suivi paiements et balances fournisseurs
 * - Extraction pièces détachées des factures
 */
export class VATBillingService {
  private formatContactInfo(supplier: typeof suppliers.$inferSelect): string | null {
    const parts = [supplier.contactName, supplier.email, supplier.phone]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value);

    return parts.length > 0 ? parts.join(" | ") : null;
  }
  
  /**
   * TVA par défaut au Cameroun
   */
  private readonly VAT_RATE = DEFAULT_VAT_RATE;
  
  /**
   * Helper pour parser les numeric columns (string) en number
   */
  private num(v: unknown): number {
    return Number.parseFloat(String(v ?? 0));
  }
  
  /**
   * Calcule le montant payé (totalTTC - balance)
   */
  private paid(inv: typeof supplierInvoices.$inferSelect): number {
    return Math.max(this.num(inv.totalTTC) - this.num(inv.balance), 0);
  }
  
  /**
   * Récupère la synthèse complète des factures fournisseurs
   */
  async getSuppliersSummary() {
    console.log("Fetching suppliers summary with invoices...");
    
    // Récupérer tous les fournisseurs avec leurs factures
    const allSuppliers = await db
      .select()
      .from(suppliers)
      .orderBy(suppliers.name);
    
    const summary: any[] = [];
    
    for (const supplier of allSuppliers) {
      // Récupérer les factures du fournisseur
      const invoices = await db
        .select()
        .from(supplierInvoices)
        .where(eq(supplierInvoices.supplierId, supplier.id))
        .orderBy(desc(supplierInvoices.invoiceDate));
      
      // Calculer les totaux
      const totalHT = invoices.reduce((sum, inv) => sum + this.num(inv.amountHT), 0);
      const totalTVA = invoices.reduce((sum, inv) => sum + this.num(inv.vatAmount), 0);
      const totalTTC = invoices.reduce((sum, inv) => sum + this.num(inv.totalTTC), 0);
      const totalPaid = invoices.reduce((sum, inv) => sum + this.paid(inv), 0);
      const balance = invoices.reduce((sum, inv) => sum + this.num(inv.balance), 0);
      
      // Grouper par famille
      const familiesMap = new Map<string, number>();
      invoices.forEach(inv => {
        if (inv.family) {
          const current = familiesMap.get(inv.family) || 0;
          familiesMap.set(inv.family, current + this.num(inv.totalTTC));
        }
      });
      
      summary.push({
        supplier: {
          id: supplier.id,
          name: supplier.name,
          contactInfo: this.formatContactInfo(supplier)
        },
        totals: {
          invoicesCount: invoices.length,
          totalHT: Math.round(totalHT),
          totalTVA: Math.round(totalTVA),
          totalTTC: Math.round(totalTTC),
          totalPaid: Math.round(totalPaid),
          balance: Math.round(balance)
        },
        families: Array.from(familiesMap.entries()).map(([name, amount]) => ({
          name,
          amount: Math.round(amount)
        })).sort((a, b) => b.amount - a.amount)
      });
    }
    
    // Trier par solde décroissant (fournisseurs avec le plus grand solde impayé d'abord)
    summary.sort((a, b) => b.totals.balance - a.totals.balance);
    
    console.log(`Suppliers summary: ${summary.length} suppliers processed`);
    return summary;
  }
  
  /**
   * Statistiques globales par famille de produits
   */
  async getInvoicesByFamily() {
    console.log("Fetching invoices statistics by product family...");
    
    const byFamily = await db
      .select({
        family: supplierInvoices.family,
        invoicesCount: sql<string>`COUNT(*)`,
        totalHT: sql<string>`COALESCE(SUM(${supplierInvoices.amountHT}), 0)`,
        totalTVA: sql<string>`COALESCE(SUM(${supplierInvoices.vatAmount}), 0)`,
        totalTTC: sql<string>`COALESCE(SUM(${supplierInvoices.totalTTC}), 0)`,
        avgQuantity: sql<string>`COALESCE(AVG(${supplierInvoices.quantity}), 0)`,
        totalQuantity: sql<string>`COALESCE(SUM(${supplierInvoices.quantity}), 0)`
      })
      .from(supplierInvoices)
      .groupBy(supplierInvoices.family)
      .orderBy(desc(sql<string>`COALESCE(SUM(${supplierInvoices.totalTTC}), 0)`));
    
    const result = byFamily.map(item => ({
      family: item.family || 'NON DÉFINI',
      invoicesCount: Number(item.invoicesCount || 0),
      totalHT: Math.round(parseFloat(item.totalHT || "0")),
      totalTVA: Math.round(parseFloat(item.totalTVA || "0")),
      totalTTC: Math.round(parseFloat(item.totalTTC || "0")),
      averageQuantity: parseFloat(item.avgQuantity || "0"),
      totalQuantity: parseFloat(item.totalQuantity || "0")
    }));
    
    console.log(`Statistics by family: ${result.length} families found`);
    return result;
  }
  
  /**
   * Récupère les factures d'un fournisseur avec suivi paiements
   */
  async getSupplierInvoicesWithPayments(supplierId: number) {
    console.log(`Fetching invoices for supplier ${supplierId}...`);
    
    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    
    if (!supplier) {
      throw new Error(`Fournisseur ${supplierId} non trouvé`);
    }
    
    const invoices = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.supplierId, supplierId))
      .orderBy(desc(supplierInvoices.invoiceDate));
    
    // Enrichir avec statut paiement
    const enrichedInvoices = invoices.map(inv => {
      const totalTTC = this.num(inv.totalTTC);
      const amountPaid = this.paid(inv);
      const balance = this.num(inv.balance);
      
      let paymentStatus: 'paid' | 'partial' | 'unpaid';
      
      if (balance === 0) {
        paymentStatus = 'paid';
      } else if (amountPaid > 0) {
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'unpaid';
      }
      
      return {
        ...inv,
        paymentStatus,
        paymentPercentage: totalTTC > 0 ? Math.round((amountPaid / totalTTC) * 100) : 0
      };
    });
    
    const result = {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        contactInfo: this.formatContactInfo(supplier)
      },
      invoices: enrichedInvoices,
      summary: {
        totalInvoices: invoices.length,
        paidInvoices: enrichedInvoices.filter(i => i.paymentStatus === 'paid').length,
        partialInvoices: enrichedInvoices.filter(i => i.paymentStatus === 'partial').length,
        unpaidInvoices: enrichedInvoices.filter(i => i.paymentStatus === 'unpaid').length,
        totalAmount: Math.round(invoices.reduce((sum, inv) => sum + this.num(inv.totalTTC), 0)),
        totalPaid: Math.round(invoices.reduce((sum, inv) => sum + this.paid(inv), 0)),
        totalBalance: Math.round(invoices.reduce((sum, inv) => sum + this.num(inv.balance), 0))
      }
    };
    
    console.log(`Found ${invoices.length} invoices for supplier ${supplierId}`);
    return result;
  }
  
  /**
   * Calcule la TVA pour un montant HT
   */
  calculateVAT(amountHT: number) {
    return computeVAT(amountHT, this.VAT_RATE);
  }
  
  /**
   * Récupère les pièces extraites d'une facture
   */
  async getPartsFromInvoice(invoiceId: number) {
    console.log(`Fetching parts extracted from invoice ${invoiceId}...`);
    
    const [invoice] = await db
      .select()
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, invoiceId));
    
    if (!invoice) {
      throw new Error(`Facture ${invoiceId} non trouvée`);
    }
    
    // Récupérer les pièces qui référencent cette facture via deliveryReceiptNumber
    const extractedParts = await db
      .select()
      .from(parts)
      .where(eq(parts.deliveryReceiptNumber, invoice.invoiceNumber));
    
    const result = {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        totalTTC: parseFloat(invoice.totalTTC || "0"),
        family: invoice.family
      },
      parts: extractedParts.map(part => ({
        id: part.id,
        name: part.name,
        reference: part.reference,
        category: part.category,
        unitPrice: this.num(part.unitPrice),
        realStock: part.realStock ?? 0
      })),
      summary: {
        partsCount: extractedParts.length,
        totalValue: extractedParts.reduce((sum, part) => sum + (this.num(part.unitPrice) * (part.realStock ?? 0)), 0)
      }
    };
    
    console.log(`Found ${extractedParts.length} parts from invoice ${invoiceId}`);
    return result;
  }
  
  /**
   * Statistiques TVA mensuelles
   */
  async getMonthlyVATStats(year: number, month: number) {
    console.log(`Fetching monthly VAT stats for ${year}-${month}...`);
    
    // Filtrer les factures du mois
    const monthInvoices = await db
      .select()
      .from(supplierInvoices)
      .where(
        sql`EXTRACT(YEAR FROM ${supplierInvoices.invoiceDate}) = ${year} 
            AND EXTRACT(MONTH FROM ${supplierInvoices.invoiceDate}) = ${month}`
      );
    
    const totalHT = monthInvoices.reduce((sum, inv) => sum + this.num(inv.amountHT), 0);
    const totalTVA = monthInvoices.reduce((sum, inv) => sum + this.num(inv.vatAmount), 0);
    const totalTTC = monthInvoices.reduce((sum, inv) => sum + this.num(inv.totalTTC), 0);
    
    // Grouper par fournisseur
    const bySupplier = new Map<number, { name: string; totalHT: number; totalTVA: number }>();
    
    for (const inv of monthInvoices) {
      if (!inv.supplierId) continue;
      
      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, inv.supplierId));
      
      if (supplier) {
        const current = bySupplier.get(supplier.id) || { 
          name: supplier.name, 
          totalHT: 0, 
          totalTVA: 0 
        };
        
        current.totalHT += this.num(inv.amountHT);
        current.totalTVA += this.num(inv.vatAmount);
        
        bySupplier.set(supplier.id, current);
      }
    }
    
    const result = {
      year,
      month,
      invoicesCount: monthInvoices.length,
      totalHT: Math.round(totalHT),
      totalTVA: Math.round(totalTVA),
      totalTTC: Math.round(totalTTC),
      vatRate: this.VAT_RATE,
      bySupplier: Array.from(bySupplier.entries()).map(([id, data]) => ({
        supplierId: id,
        supplierName: data.name,
        totalHT: Math.round(data.totalHT),
        totalTVA: Math.round(data.totalTVA)
      })).sort((a, b) => b.totalTVA - a.totalTVA)
    };
    
    console.log(`Monthly VAT stats: ${result.invoicesCount} invoices, ${result.totalTVA} FCFA TVA`);
    return result;
  }
  
  /**
   * Top fournisseurs par montant
   */
  async getTopSuppliers(limit: number = 10) {
    console.log(`Fetching top ${limit} suppliers by amount...`);
    
    const topSuppliers = await db
      .select({
        supplierId: supplierInvoices.supplierId,
        totalAmount: sql<string>`COALESCE(SUM(${supplierInvoices.totalTTC}), 0)`,
        invoicesCount: sql<string>`COUNT(*)`,
        totalBalance: sql<string>`COALESCE(SUM(${supplierInvoices.balance}), 0)`
      })
      .from(supplierInvoices)
      .groupBy(supplierInvoices.supplierId)
      .orderBy(desc(sql<string>`COALESCE(SUM(${supplierInvoices.totalTTC}), 0)`))
      .limit(limit);
    
    const result: any[] = [];
    
    for (const item of topSuppliers) {
      if (item.supplierId == null) {
        continue;
      }

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, item.supplierId));
      
      if (supplier) {
        result.push({
          supplier: {
            id: supplier.id,
            name: supplier.name,
            contactInfo: this.formatContactInfo(supplier)
          },
          totalAmount: Math.round(parseFloat(item.totalAmount || "0")),
          invoicesCount: Number(item.invoicesCount || 0),
          totalBalance: Math.round(parseFloat(item.totalBalance || "0"))
        });
      }
    }
    
    console.log(`Top suppliers: ${result.length} suppliers returned`);
    return result;
  }
}

export const vatBillingService = new VATBillingService();
