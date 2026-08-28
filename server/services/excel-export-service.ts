import { db } from "../db";
import {
  supplierInvoices,
  suppliers,
  parts,
  fuelRecords,
  vehicles,
  missions,
  clientInvoices,
  clients,
} from "@shared/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import * as XLSX from 'xlsx';

/**
 * Service Exports Excel
 * 
 * Responsabilités:
 * - Export factures fournisseurs (96 factures)
 * - Export inventaire stock (58 pièces, 94.4M FCFA)
 * - Export consommation carburant (24 enregistrements)
 * - Export missions et opérations
 * - Export factures clients
 * - Rapport comptable mensuel complet
 */
export class ExcelExportService {
  
  /**
   * Export factures fournisseurs (96 factures)
   */
  async exportSupplierInvoices() {
    console.log("Exporting supplier invoices...");

    const invoices = await db
      .select({
        invoice: supplierInvoices,
        supplier: suppliers,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .orderBy(desc(supplierInvoices.invoiceDate));

    const data = invoices.map(inv => ({
      "N° Facture": inv.invoice.invoiceNumber,
      "Fournisseur": inv.supplier?.name || "N/A",
      "Date": new Date(inv.invoice.invoiceDate).toLocaleDateString('fr-FR'),
      "Famille": inv.invoice.family || "N/A",
      "Montant HT": parseFloat(inv.invoice.amountHT || "0"),
      "TVA 19.25%": parseFloat(inv.invoice.vatAmount || "0"),
      "Montant TTC": parseFloat(inv.invoice.totalTTC || "0"),
      "Paiements": parseFloat(inv.invoice.totalTTC || "0") - parseFloat(inv.invoice.balance || "0"),
      "Solde": parseFloat(inv.invoice.balance || "0"),
      "Statut": parseFloat(inv.invoice.balance || "0") > 0 ? "IMPAYÉ" : "PAYÉ",
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Factures Fournisseurs");

    console.log(`Exported ${data.length} supplier invoices`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export inventaire stock (58 pièces, 94.4M FCFA)
   */
  async exportInventory() {
    console.log("Exporting inventory...");

    const partsList = await db
      .select()
      .from(parts)
      .orderBy(parts.category, parts.name);

    const data = partsList.map(part => ({
      "Référence": part.reference,
      "Désignation": part.name,
      "Catégorie": part.category || "N/A",
      "Stock Théorique": part.quantity,
      "Stock Réel": part.realStock || 0,
      "Seuil Min": part.minQuantity,
      "Unité": part.unit,
      "Alerte CDE": part.reorderAlert ? "OUI" : "NON",
      "Prix Unitaire": parseFloat(part.unitPrice || "0"),
      "Valeur Stock": (part.realStock || 0) * parseFloat(part.unitPrice || "0"),
      "Fournisseur": part.supplier || "N/A",
      "Emplacement": part.location || "N/A",
    }));

    // Ajouter ligne totale
    const totalValue = data.reduce((sum, item) => sum + item["Valeur Stock"], 0);
    const totalParts = data.length;
    
    data.push({
      "Référence": "TOTAL",
      "Désignation": `${totalParts} pièces`,
      "Catégorie": "",
      "Stock Théorique": null,
      "Stock Réel": null,
      "Seuil Min": null,
      "Unité": "",
      "Alerte CDE": "",
      "Prix Unitaire": null,
      "Valeur Stock": totalValue,
      "Fournisseur": "",
      "Emplacement": "",
    } as any);

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventaire");

    console.log(`Exported ${totalParts} parts, total value: ${totalValue} FCFA`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export consommation carburant (24 enregistrements août 2025)
   */
  async exportFuelConsumption(year: number, month?: number) {
    console.log(`Exporting fuel consumption for ${month ? `${month}/` : ''}${year}...`);

    const conditions = [eq(fuelRecords.year, year)];

    if (month !== undefined) {
      conditions.push(eq(fuelRecords.month, month));
    }

    const records = await db
      .select({
        record: fuelRecords,
        vehicle: vehicles,
      })
      .from(fuelRecords)
      .leftJoin(vehicles, eq(fuelRecords.vehicleId, vehicles.id))
      .where(and(...conditions))
      .orderBy(desc(fuelRecords.date));

    const data = records.map(r => ({
      "Date": r.record.date ? new Date(r.record.date).toLocaleDateString('fr-FR') : "N/A",
      "Véhicule": r.vehicle?.registrationNumber || "CARTE",
      "Type": r.record.fuelType || "DIESEL",
      "Crédit (FCFA)": parseFloat(r.record.creditAmount || "0"),
      "Débit (FCFA)": parseFloat(r.record.debitAmount || "0"),
      "Quantité (L)": r.record.quantity || 0,
      "Solde FCFA": parseFloat(r.record.balance || "0"),
      "Solde Carburant": r.record.fuelBalance || 0,
      "Station": r.record.stationName || "N/A",
      "Destination": r.record.destination || "N/A",
      "Client": r.record.clientName || "N/A",
      "N° Commande": r.record.orderNumber || "N/A",
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Carburant");

    console.log(`Exported ${data.length} fuel records`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export missions et opérations clients
   */
  async exportClientOperations(clientName?: string) {
    console.log(`Exporting client operations${clientName ? ` for ${clientName}` : ''}...`);

    const conditions: any[] = [];

    if (clientName) {
      conditions.push(eq(clients.name, clientName));
    }

    let query = db
      .select({
        mission: missions,
        client: clients,
        vehicle: vehicles,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(vehicles, sql`${missions.id} = ANY(SELECT mission_id FROM assignments WHERE vehicle_id = ${vehicles.id})`);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = await query.orderBy(desc(missions.createdAt));

    const data = results.map(r => ({
      "Date": new Date(r.mission.deliveryDate || r.mission.createdAt).toLocaleDateString('fr-FR'),
      "N° Commande": r.mission.orderNumber,
      "Client": r.client?.name || "N/A",
      "Véhicule": r.vehicle?.registrationNumber || "N/A",
      "Départ": r.mission.pickupAddress,
      "Destination": r.mission.deliveryAddress,
      "Carburant (L)": r.mission.actualFuelQuantity || 0,
      "Coût Carburant": parseFloat(String(r.mission.actualFuelCost || 0)),
      "Distance (km)": r.mission.actualDistance || r.mission.estimatedDistance || 0,
      "Statut": r.mission.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Opérations");

    console.log(`Exported ${data.length} operations`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export factures clients
   */
  async exportClientInvoices(clientName?: string) {
    console.log(`Exporting client invoices${clientName ? ` for ${clientName}` : ''}...`);

    const conditions: any[] = [];

    if (clientName) {
      conditions.push(eq(clients.name, clientName));
    }

    let query = db
      .select({
        invoice: clientInvoices,
        client: clients,
        mission: missions,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id))
      .leftJoin(missions, eq(clientInvoices.missionId, missions.id));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = await query.orderBy(desc(clientInvoices.invoiceDate));

    const data = results.map(r => ({
      "N° Facture": r.invoice.invoiceNumber,
      "Client": r.client?.name || "N/A",
      "Date": new Date(r.invoice.invoiceDate).toLocaleDateString('fr-FR'),
      "Échéance": new Date(r.invoice.dueDate).toLocaleDateString('fr-FR'),
      "Mission": r.mission?.orderNumber || "N/A",
      "Montant HT": parseFloat(r.invoice.amountHT || "0"),
      "TVA 19.25%": parseFloat(r.invoice.vatAmount || "0"),
      "Montant TTC": parseFloat(r.invoice.amountTTC || "0"),
      "Solde": parseFloat(r.invoice.balance || "0"),
      "Statut": r.invoice.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Factures Clients");

    console.log(`Exported ${data.length} client invoices`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Rapport comptable mensuel complet
   */
  async exportMonthlyAccountingReport(year: number, month: number) {
    console.log(`Generating monthly accounting report for ${month}/${year}...`);

    const workbook = XLSX.utils.book_new();

    // 1. Synthèse générale
    const summary = await this.getMonthlyReportSummary(year, month);
    const summarySheet = XLSX.utils.json_to_sheet([summary]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Synthèse");

    // 2. Factures fournisseurs du mois
    const supplierInv = await this.getMonthlySupplierInvoices(year, month);
    if (supplierInv.length > 0) {
      const suppSheet = XLSX.utils.json_to_sheet(supplierInv);
      XLSX.utils.book_append_sheet(workbook, suppSheet, "Factures Fournisseurs");
    }

    // 3. Factures clients du mois
    const clientInv = await this.getMonthlyClientInvoices(year, month);
    if (clientInv.length > 0) {
      const cliSheet = XLSX.utils.json_to_sheet(clientInv);
      XLSX.utils.book_append_sheet(workbook, cliSheet, "Factures Clients");
    }

    // 4. Consommation carburant
    const fuelData = await this.getMonthlyFuelData(year, month);
    if (fuelData.length > 0) {
      const fuelSheet = XLSX.utils.json_to_sheet(fuelData);
      XLSX.utils.book_append_sheet(workbook, fuelSheet, "Carburant");
    }

    console.log(`Monthly report generated for ${month}/${year}`);
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  private async getMonthlyReportSummary(year: number, month: number) {
    const [fuelStats] = await db
      .select({
        totalCredits: sql<string>`COALESCE(SUM(${fuelRecords.creditAmount}), 0)`,
        totalDebits: sql<string>`COALESCE(SUM(${fuelRecords.debitAmount}), 0)`,
      })
      .from(fuelRecords)
      .where(
        and(
          eq(fuelRecords.year, year),
          eq(fuelRecords.month, month)
        )
      );

    return {
      "Période": `${month}/${year}`,
      "Carburant - Crédits": parseFloat(fuelStats?.totalCredits || "0"),
      "Carburant - Débits": parseFloat(fuelStats?.totalDebits || "0"),
      "Carburant - Solde": parseFloat(fuelStats?.totalCredits || "0") - parseFloat(fuelStats?.totalDebits || "0"),
    };
  }

  private async getMonthlySupplierInvoices(year: number, month: number) {
    const invoices = await db
      .select({
        invoice: supplierInvoices,
        supplier: suppliers,
      })
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id));

    return invoices
      .filter(inv => {
        const date = new Date(inv.invoice.invoiceDate);
        return date.getFullYear() === year && date.getMonth() + 1 === month;
      })
      .map(inv => ({
        "N° Facture": inv.invoice.invoiceNumber,
        "Fournisseur": inv.supplier?.name || "N/A",
        "Date": new Date(inv.invoice.invoiceDate).toLocaleDateString('fr-FR'),
        "Montant HT": parseFloat(inv.invoice.amountHT || "0"),
        "TVA": parseFloat(inv.invoice.vatAmount || "0"),
        "TTC": parseFloat(inv.invoice.totalTTC || "0"),
        "Solde": parseFloat(inv.invoice.balance || "0"),
      }));
  }

  private async getMonthlyClientInvoices(year: number, month: number) {
    const invoices = await db
      .select({
        invoice: clientInvoices,
        client: clients,
      })
      .from(clientInvoices)
      .leftJoin(clients, eq(clientInvoices.clientId, clients.id));

    return invoices
      .filter(inv => {
        const date = new Date(inv.invoice.invoiceDate);
        return date.getFullYear() === year && date.getMonth() + 1 === month;
      })
      .map(inv => ({
        "N° Facture": inv.invoice.invoiceNumber,
        "Client": inv.client?.name || "N/A",
        "Date": new Date(inv.invoice.invoiceDate).toLocaleDateString('fr-FR'),
        "Montant HT": parseFloat(inv.invoice.amountHT || "0"),
        "TVA": parseFloat(inv.invoice.vatAmount || "0"),
        "TTC": parseFloat(inv.invoice.amountTTC || "0"),
        "Solde": parseFloat(inv.invoice.balance || "0"),
      }));
  }

  private async getMonthlyFuelData(year: number, month: number) {
    const records = await db
      .select({
        record: fuelRecords,
        vehicle: vehicles,
      })
      .from(fuelRecords)
      .leftJoin(vehicles, eq(fuelRecords.vehicleId, vehicles.id))
      .where(
        and(
          eq(fuelRecords.year, year),
          eq(fuelRecords.month, month)
        )
      );

    return records.map(r => ({
      "Date": r.record.date ? new Date(r.record.date).toLocaleDateString('fr-FR') : "N/A",
      "Véhicule": r.vehicle?.registrationNumber || "CARTE",
      "Crédit": parseFloat(r.record.creditAmount || "0"),
      "Débit": parseFloat(r.record.debitAmount || "0"),
      "Quantité (L)": r.record.quantity || 0,
      "Solde": parseFloat(r.record.balance || "0"),
    }));
  }
}

export const excelExportService = new ExcelExportService();
