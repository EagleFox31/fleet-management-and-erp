# 🚀 SPRINT 4 - PLANIFICATION DÉTAILLÉE
## Opérations & Facturation Clients - Sprint Final Phase 2

**Date:** 6 octobre 2025  
**Sprint:** Phase 2 - Sprint 4 (Semaines 7-8)  
**Durée:** 12 jours  
**Architecture:** Service Opérations + Facturation + Exports Excel

---

## 🎯 OBJECTIFS DU SPRINT 4

### Vision globale
Développer le **module opérations et facturation clients** en exploitant les données réelles de carburant (24 enregistrements août 2025) pour créer un système complet de gestion des missions et facturation automatique.

### Résultats attendus
- ✅ Service Opérations & Facturation opérationnel
- ✅ Création missions depuis consommation carburant réelle
- ✅ Facturation clients automatique (MAERSK, CNPCC, AGL, SODECOTON)
- ✅ Exports Excel pour tous les modules
- ✅ Rapports comptables automatisés
- ✅ Phase 2 complète et prête pour production

---

## 🏗️ ARCHITECTURE SERVICE OPÉRATIONS

### **Backend - Structure**
```
server/
├── services/
│   ├── operations-service.ts           # 🆕 Sprint 4 - Gestion missions
│   ├── client-billing-service.ts       # 🆕 Sprint 4 - Facturation clients
│   └── excel-export-service.ts         # 🆕 Sprint 4 - Exports Excel
├── api/
│   ├── operations.routes.ts            # 🆕 Sprint 4 - Routes opérations
│   └── exports.routes.ts               # 🆕 Sprint 4 - Routes exports
```

### **Frontend - Structure**
```
client/src/
├── pages/
│   ├── operations/
│   │   ├── dashboard.tsx               # 🆕 Dashboard opérations
│   │   ├── mission-planner.tsx         # 🆕 Planification missions
│   │   └── client-invoices.tsx         # 🆕 Factures clients
│   └── exports/
│       └── reports.tsx                 # 🆕 Centre export/rapports
├── components/
│   ├── operations/
│   │   ├── mission-form.tsx            # Création mission
│   │   ├── fuel-cost-calculator.tsx    # Calcul coûts carburant
│   │   └── client-invoice-generator.tsx # Génération factures
│   └── exports/
│       ├── excel-export-button.tsx     # Export Excel générique
│       └── report-generator.tsx        # Générateur rapports
```

---

## 📋 TÂCHES DÉTAILLÉES

### **JOUR 1-4 : Service Opérations & Missions** 🔴

#### **JOUR 1 : Backend Service Opérations** (6h)

**Tâche 1.1 : Créer Operations Service** (4h)
```typescript
// server/services/operations-service.ts

import { db } from "../db";
import { operations, vehicles, fuelRecords, drivers } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export class OperationsService {
  /**
   * Créer une mission depuis un enregistrement carburant réel
   * Exploite les 24 enregistrements carburant août 2025
   */
  async createMissionFromFuel(fuelRecordId: number, additionalData: {
    clientName: string;
    roadExpenses: number;
    invoiceAmount?: number;
  }) {
    const fuelRecord = await db.select()
      .from(fuelRecords)
      .where(eq(fuelRecords.id, fuelRecordId))
      .then(rows => rows[0]);

    if (!fuelRecord) throw new Error("Enregistrement carburant non trouvé");

    // Créer la mission avec données réelles
    const mission = await db.insert(operations).values({
      date: fuelRecord.date,
      vehicleId: fuelRecord.vehicleId,
      fuelRecordId: fuelRecord.id,
      departure: "DOUALA", // Ou depuis données
      destination: fuelRecord.destination,
      clientName: additionalData.clientName,
      fuelConsumption: fuelRecord.quantity,
      fuelCost: parseFloat(fuelRecord.debitAmount || "0"),
      roadExpenses: additionalData.roadExpenses,
      totalCost: parseFloat(fuelRecord.debitAmount || "0") + additionalData.roadExpenses,
      status: "completed",
    }).returning();

    return mission[0];
  }

  /**
   * Récupérer missions par client
   * Clients réels : MAERSK, CNPCC, AGL, SODECOTON
   */
  async getMissionsByClient(clientName: string, filters?: {
    startDate?: Date;
    endDate?: Date;
  }) {
    let query = db.select()
      .from(operations)
      .where(eq(operations.clientName, clientName));

    if (filters?.startDate && filters?.endDate) {
      query = query.where(and(
        gte(operations.date, filters.startDate),
        lte(operations.date, filters.endDate)
      ));
    }

    const missions = await query;

    // Calculer statistiques
    const totalFuel = missions.reduce((sum, m) => sum + (m.fuelConsumption || 0), 0);
    const totalCost = missions.reduce((sum, m) => sum + (m.totalCost || 0), 0);
    const totalRevenue = missions.reduce((sum, m) => sum + (m.invoiceAmount || 0), 0);

    return {
      missions,
      statistics: {
        totalMissions: missions.length,
        totalFuelConsumed: totalFuel,
        totalCost,
        totalRevenue,
        margin: totalRevenue - totalCost,
        marginPercentage: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0
      }
    };
  }

  /**
   * Calculer coûts mission depuis données réelles
   */
  async calculateMissionCosts(missionId: number) {
    const mission = await db.select()
      .from(operations)
      .where(eq(operations.id, missionId))
      .then(rows => rows[0]);

    if (!mission) throw new Error("Mission non trouvée");

    // Coût carburant depuis fuelRecords
    const fuelCost = mission.fuelCost || 0;
    
    // Coût véhicule (amortissement si disponible)
    let vehicleCost = 0;
    if (mission.vehicleId) {
      const vehicle = await db.select()
        .from(vehicles)
        .where(eq(vehicles.id, mission.vehicleId))
        .then(rows => rows[0]);
      
      if (vehicle?.purchasePrice) {
        // Amortissement simple : prix achat / 1000 jours * 1 jour
        vehicleCost = parseFloat(vehicle.purchasePrice) / 1000;
      }
    }

    return {
      fuelCost,
      roadExpenses: mission.roadExpenses || 0,
      vehicleCost,
      totalCost: fuelCost + (mission.roadExpenses || 0) + vehicleCost,
      breakdown: {
        fuel: fuelCost,
        road: mission.roadExpenses || 0,
        vehicle: vehicleCost
      }
    };
  }

  /**
   * Statistiques par destination
   * Destinations réelles : NDJAMENA, DLA-NDERE, TOUBORO
   */
  async getStatsByDestination() {
    const missions = await db.select().from(operations);
    
    const byDestination = missions.reduce((acc, mission) => {
      const dest = mission.destination || "AUTRE";
      if (!acc[dest]) {
        acc[dest] = {
          count: 0,
          totalFuel: 0,
          totalCost: 0,
          totalRevenue: 0
        };
      }
      acc[dest].count++;
      acc[dest].totalFuel += mission.fuelConsumption || 0;
      acc[dest].totalCost += mission.totalCost || 0;
      acc[dest].totalRevenue += mission.invoiceAmount || 0;
      return acc;
    }, {} as Record<string, any>);

    return byDestination;
  }
}

export const operationsService = new OperationsService();
```

**Tâche 1.2 : Créer API Routes Opérations** (2h)
```typescript
// server/api/operations.routes.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { operationsService } from "../services/operations-service";

const router = Router();
router.use(authenticate);

// POST /api/operations/from-fuel
router.post("/from-fuel", async (req, res) => {
  try {
    const { fuelRecordId, clientName, roadExpenses, invoiceAmount } = req.body;
    
    const mission = await operationsService.createMissionFromFuel(fuelRecordId, {
      clientName,
      roadExpenses,
      invoiceAmount
    });
    
    res.json(mission);
  } catch (error) {
    console.error("Create mission error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/operations/by-client/:clientName
router.get("/by-client/:clientName", async (req, res) => {
  try {
    const { clientName } = req.params;
    const { startDate, endDate } = req.query;
    
    const result = await operationsService.getMissionsByClient(clientName, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });
    
    res.json(result);
  } catch (error) {
    console.error("Get missions by client error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/operations/:id/costs
router.get("/:id/costs", async (req, res) => {
  try {
    const costs = await operationsService.calculateMissionCosts(parseInt(req.params.id));
    res.json(costs);
  } catch (error) {
    console.error("Calculate costs error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/operations/stats/by-destination
router.get("/stats/by-destination", async (req, res) => {
  try {
    const stats = await operationsService.getStatsByDestination();
    res.json(stats);
  } catch (error) {
    console.error("Get stats by destination error:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
```

#### **JOUR 2 : Service Facturation Clients** (6h)

**Tâche 2.1 : Créer Client Billing Service** (4h)
```typescript
// server/services/client-billing-service.ts

export class ClientBillingService {
  /**
   * Générer facture client depuis mission
   */
  async generateInvoiceFromMission(missionId: number, invoiceData: {
    invoiceNumber: string;
    amount: number;
    dueDate: Date;
    includeVAT: boolean;
  }) {
    const mission = await db.select()
      .from(operations)
      .where(eq(operations.id, missionId))
      .then(rows => rows[0]);

    if (!mission) throw new Error("Mission non trouvée");

    // Calculer montants avec TVA si demandé
    const amountHT = invoiceData.amount;
    const vatAmount = invoiceData.includeVAT ? amountHT * 0.1925 : 0; // TVA 19.25%
    const amountTTC = amountHT + vatAmount;

    const invoice = await db.insert(clientInvoices).values({
      missionId,
      clientName: mission.clientName,
      invoiceNumber: invoiceData.invoiceNumber,
      invoiceDate: new Date(),
      dueDate: invoiceData.dueDate,
      amountHT,
      vatAmount,
      amountTTC,
      balance: amountTTC,
      status: "pending",
      items: [{
        description: `Mission ${mission.destination} - ${new Date(mission.date).toLocaleDateString()}`,
        quantity: 1,
        unitPrice: amountHT,
        total: amountHT
      }]
    }).returning();

    // Mettre à jour la mission
    await db.update(operations)
      .set({ invoiceAmount: amountTTC })
      .where(eq(operations.id, missionId));

    return invoice[0];
  }

  /**
   * Récupérer factures client avec solde
   * Clients réels : MAERSK, CNPCC, AGL, SODECOTON
   */
  async getClientInvoices(clientName?: string) {
    let query = db.select().from(clientInvoices);
    
    if (clientName) {
      query = query.where(eq(clientInvoices.clientName, clientName));
    }

    const invoices = await query;
    
    return {
      invoices,
      summary: {
        total: invoices.length,
        totalAmountHT: invoices.reduce((sum, inv) => sum + parseFloat(inv.amountHT || "0"), 0),
        totalVAT: invoices.reduce((sum, inv) => sum + parseFloat(inv.vatAmount || "0"), 0),
        totalAmountTTC: invoices.reduce((sum, inv) => sum + parseFloat(inv.amountTTC || "0"), 0),
        totalBalance: invoices.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0),
        pending: invoices.filter(inv => inv.status === "pending").length,
        paid: invoices.filter(inv => inv.status === "paid").length
      }
    };
  }

  /**
   * Enregistrer paiement client
   */
  async recordPayment(invoiceId: number, paymentData: {
    amount: number;
    paymentDate: Date;
    paymentMethod: string;
    reference?: string;
  }) {
    const invoice = await db.select()
      .from(clientInvoices)
      .where(eq(clientInvoices.id, invoiceId))
      .then(rows => rows[0]);

    if (!invoice) throw new Error("Facture non trouvée");

    const newBalance = parseFloat(invoice.balance) - paymentData.amount;
    const newStatus = newBalance <= 0 ? "paid" : "partial";

    await db.update(clientInvoices)
      .set({
        balance: newBalance.toString(),
        status: newStatus
      })
      .where(eq(clientInvoices.id, invoiceId));

    // Enregistrer le paiement
    await db.insert(clientPayments).values({
      invoiceId,
      amount: paymentData.amount.toString(),
      paymentDate: paymentData.paymentDate,
      paymentMethod: paymentData.paymentMethod,
      reference: paymentData.reference
    });

    return { newBalance, status: newStatus };
  }

  /**
   * Rapport facturation par client
   */
  async getClientBillingReport(clientName: string, year: number, month?: number) {
    const invoices = await this.getClientInvoices(clientName);
    const clientInvoices = invoices.invoices.filter(inv => {
      const invDate = new Date(inv.invoiceDate);
      return invDate.getFullYear() === year && 
             (month === undefined || invDate.getMonth() + 1 === month);
    });

    return {
      clientName,
      period: month ? `${month}/${year}` : year.toString(),
      totalInvoices: clientInvoices.length,
      totalAmountHT: clientInvoices.reduce((sum, inv) => sum + parseFloat(inv.amountHT || "0"), 0),
      totalVAT: clientInvoices.reduce((sum, inv) => sum + parseFloat(inv.vatAmount || "0"), 0),
      totalAmountTTC: clientInvoices.reduce((sum, inv) => sum + parseFloat(inv.amountTTC || "0"), 0),
      totalPaid: clientInvoices.reduce((sum, inv) => {
        const balance = parseFloat(inv.balance || "0");
        const total = parseFloat(inv.amountTTC || "0");
        return sum + (total - balance);
      }, 0),
      totalOutstanding: clientInvoices.reduce((sum, inv) => sum + parseFloat(inv.balance || "0"), 0),
      invoices: clientInvoices
    };
  }
}

export const clientBillingService = new ClientBillingService();
```

#### **JOUR 3-4 : Service Exports Excel** (12h)

**Tâche 3.1 : Créer Excel Export Service** (6h)
```typescript
// server/services/excel-export-service.ts

import * as XLSX from 'xlsx';

export class ExcelExportService {
  /**
   * Export factures fournisseurs (96 factures)
   */
  async exportSupplierInvoices() {
    const invoices = await db.select()
      .from(supplierInvoices)
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id));

    const data = invoices.map(inv => ({
      "N° Facture": inv.supplier_invoices.invoiceNumber,
      "Fournisseur": inv.suppliers?.name,
      "Date": new Date(inv.supplier_invoices.invoiceDate).toLocaleDateString(),
      "Famille": inv.supplier_invoices.family,
      "Montant HT": parseFloat(inv.supplier_invoices.amountHT || "0"),
      "TVA 19.25%": parseFloat(inv.supplier_invoices.vatAmount || "0"),
      "Montant TTC": parseFloat(inv.supplier_invoices.totalTTC || "0"),
      "Paiements": parseFloat(inv.supplier_invoices.totalTTC || "0") - parseFloat(inv.supplier_invoices.balance || "0"),
      "Solde": parseFloat(inv.supplier_invoices.balance || "0"),
      "Statut": inv.supplier_invoices.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Factures Fournisseurs");

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export stock pièces (58 pièces, 94.4M FCFA)
   */
  async exportInventory() {
    const parts = await db.select().from(parts);

    const data = parts.map(part => ({
      "Référence": part.reference,
      "Désignation": part.name,
      "Catégorie": part.category,
      "Stock Théorique": part.quantity,
      "Stock Réel": part.realStock,
      "Seuil Min": part.minQuantity,
      "Alerte CDE": part.reorderAlert ? "OUI" : "NON",
      "Prix Unitaire": parseFloat(part.unitPrice || "0"),
      "Valeur Stock": part.realStock * parseFloat(part.unitPrice || "0"),
      "Fournisseur": part.supplier,
      "Emplacement": part.location
    }));

    // Ajouter ligne totale
    const totalValue = data.reduce((sum, item) => sum + item["Valeur Stock"], 0);
    data.push({
      "Référence": "TOTAL",
      "Désignation": "",
      "Catégorie": "",
      "Stock Théorique": null,
      "Stock Réel": null,
      "Seuil Min": null,
      "Alerte CDE": "",
      "Prix Unitaire": null,
      "Valeur Stock": totalValue,
      "Fournisseur": "",
      "Emplacement": ""
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventaire");

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export consommation carburant (24 enregistrements)
   */
  async exportFuelConsumption(year: number, month?: number) {
    let records = await db.select()
      .from(fuelRecords)
      .leftJoin(vehicles, eq(fuelRecords.vehicleId, vehicles.id));

    // Filtrer par période
    records = records.filter(r => {
      const date = new Date(r.fuel_records.date);
      return date.getFullYear() === year && 
             (month === undefined || date.getMonth() + 1 === month);
    });

    const data = records.map(r => ({
      "Date": new Date(r.fuel_records.date).toLocaleDateString(),
      "Véhicule": r.vehicles?.registrationNumber || "CARTE",
      "Type": r.fuel_records.fuelType,
      "Crédit (FCFA)": parseFloat(r.fuel_records.creditAmount || "0"),
      "Débit (FCFA)": parseFloat(r.fuel_records.debitAmount || "0"),
      "Quantité (L)": r.fuel_records.quantity,
      "Solde FCFA": parseFloat(r.fuel_records.balance || "0"),
      "Solde Carburant": r.fuel_records.fuelBalance,
      "Station": r.fuel_records.stationName,
      "Destination": r.fuel_records.destination,
      "Client": r.fuel_records.clientName,
      "N° Commande": r.fuel_records.orderNumber
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Carburant");

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Export missions et facturation clients
   */
  async exportClientOperations(clientName?: string) {
    let operations = await db.select()
      .from(operations)
      .leftJoin(vehicles, eq(operations.vehicleId, vehicles.id));

    if (clientName) {
      operations = operations.filter(op => op.operations.clientName === clientName);
    }

    const data = operations.map(op => ({
      "Date": new Date(op.operations.date).toLocaleDateString(),
      "Client": op.operations.clientName,
      "Véhicule": op.vehicles?.registrationNumber,
      "Départ": op.operations.departure,
      "Destination": op.operations.destination,
      "Carburant (L)": op.operations.fuelConsumption,
      "Coût Carburant": op.operations.fuelCost,
      "FDR": op.operations.roadExpenses,
      "Coût Total": op.operations.totalCost,
      "Montant Facturé": op.operations.invoiceAmount,
      "Marge": (op.operations.invoiceAmount || 0) - (op.operations.totalCost || 0),
      "Statut": op.operations.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Opérations");

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Rapport comptable mensuel complet
   */
  async exportMonthlyAccountingReport(year: number, month: number) {
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

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}

export const excelExportService = new ExcelExportService();
```

**Tâche 3.2 : Créer API Routes Exports** (3h)
```typescript
// server/api/exports.routes.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { excelExportService } from "../services/excel-export-service";

const router = Router();
router.use(authenticate);

// GET /api/exports/supplier-invoices
router.get("/supplier-invoices", async (req, res) => {
  try {
    const buffer = await excelExportService.exportSupplierInvoices();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=factures_fournisseurs.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error("Export supplier invoices error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/exports/inventory
router.get("/inventory", async (req, res) => {
  try {
    const buffer = await excelExportService.exportInventory();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=inventaire_stock.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error("Export inventory error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/exports/fuel-consumption?year=2025&month=8
router.get("/fuel-consumption", async (req, res) => {
  try {
    const { year, month } = req.query;
    const buffer = await excelExportService.exportFuelConsumption(
      parseInt(year as string),
      month ? parseInt(month as string) : undefined
    );
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=carburant_${year}_${month || 'annee'}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error("Export fuel consumption error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/exports/client-operations?client=MAERSK
router.get("/client-operations", async (req, res) => {
  try {
    const { client } = req.query;
    const buffer = await excelExportService.exportClientOperations(client as string);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=operations_${client || 'tous'}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error("Export client operations error:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/exports/monthly-report?year=2025&month=8
router.get("/monthly-report", async (req, res) => {
  try {
    const { year, month } = req.query;
    const buffer = await excelExportService.exportMonthlyAccountingReport(
      parseInt(year as string),
      parseInt(month as string)
    );
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=rapport_comptable_${month}_${year}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error("Export monthly report error:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
```

**Tâche 3.3 : Tests Services Backend** (3h)
- Tests unitaires operations-service
- Tests client-billing-service
- Tests excel-export-service
- Validation exports Excel

---

### **JOUR 5-8 : Frontend Opérations & Facturation** 🔴

#### **JOUR 5 : Dashboard Opérations** (6h)

**Tâche 5.1 : Créer Operations Dashboard** (4h)
```tsx
// client/src/pages/operations/dashboard.tsx

import { useQuery } from "@tanstack/react-query";
import { KPICard } from "@/components/dashboard/kpi-card";
import { formatNumber } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export default function OperationsDashboard() {
  const { data: statsByClient } = useQuery({
    queryKey: ["/api/operations/stats/by-client"],
  });

  const { data: statsByDestination } = useQuery({
    queryKey: ["/api/operations/stats/by-destination"],
  });

  return (
    <div>
      <PageHeader
        title="Dashboard Opérations"
        subtitle="Missions, facturation clients et analyses"
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <KPICard
          title="Missions actives"
          value={formatNumber(statsByClient?.totalMissions || 0)}
          subValue="Ce mois"
          icon="truck"
          iconColor="text-blue-600"
        />
        
        <KPICard
          title="Chiffre d'affaires"
          value={`${formatNumber(statsByClient?.totalRevenue || 0)} FCFA`}
          subValue="Facturé"
          icon="dollar-sign"
          iconColor="text-green-600"
        />

        <KPICard
          title="Marge brute"
          value={`${(statsByClient?.marginPercentage || 0).toFixed(1)}%`}
          subValue={`${formatNumber(statsByClient?.margin || 0)} FCFA`}
          icon="trending-up"
          iconColor="text-purple-600"
        />

        <KPICard
          title="Clients actifs"
          value="4"
          subValue="MAERSK, CNPCC, AGL, SODECOTON"
          icon="users"
          iconColor="text-orange-600"
        />
      </div>

      <Tabs defaultValue="missions">
        <TabsList>
          <TabsTrigger value="missions">📋 Missions</TabsTrigger>
          <TabsTrigger value="clients">👥 Clients</TabsTrigger>
          <TabsTrigger value="destinations">📍 Destinations</TabsTrigger>
          <TabsTrigger value="facturation">💰 Facturation</TabsTrigger>
        </TabsList>

        <TabsContent value="missions">
          <MissionsList />
        </TabsContent>

        <TabsContent value="clients">
          <ClientsPanel />
        </TabsContent>

        <TabsContent value="destinations">
          <DestinationsChart data={statsByDestination} />
        </TabsContent>

        <TabsContent value="facturation">
          <BillingPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Tâche 5.2 : Mission Form Component** (2h)
```tsx
// client/src/components/operations/mission-form.tsx

export function MissionForm({ fuelRecordId }: { fuelRecordId?: number }) {
  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/operations/from-fuel", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operations"] });
      toast({ title: "Mission créée avec succès" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>📋 Créer une Mission</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          {/* Sélection enregistrement carburant */}
          <Select name="fuelRecordId">
            {/* 24 enregistrements août 2025 */}
          </Select>

          {/* Client : MAERSK, CNPCC, AGL, SODECOTON */}
          <Select name="clientName">
            <SelectItem value="MAERSK">MAERSK</SelectItem>
            <SelectItem value="CNPCC">CNPCC</SelectItem>
            <SelectItem value="AGL">AGL</SelectItem>
            <SelectItem value="SODECOTON">SODECOTON</SelectItem>
          </Select>

          {/* Frais de route */}
          <Input
            type="number"
            name="roadExpenses"
            label="FDR (Frais de Route)"
            placeholder="Montant FCFA"
          />

          {/* Montant facturation */}
          <Input
            type="number"
            name="invoiceAmount"
            label="Montant à facturer"
            placeholder="Montant FCFA"
          />

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Création..." : "Créer la mission"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

#### **JOUR 6 : Facturation Clients** (6h)

**Tâche 6.1 : Client Invoice Generator** (3h)
```tsx
// client/src/components/operations/client-invoice-generator.tsx

export function ClientInvoiceGenerator({ missionId }: { missionId: number }) {
  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/billing/generate-invoice", data);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Facture générée avec succès" });
    },
  });

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>💰 Générer Facture Client</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Input
            name="invoiceNumber"
            label="N° Facture"
            placeholder="FAC-2025-001"
          />

          <Input
            type="number"
            name="amount"
            label="Montant HT"
            placeholder="Montant FCFA"
          />

          <div className="flex items-center space-x-2">
            <Checkbox id="includeVAT" />
            <label htmlFor="includeVAT">
              Inclure TVA 19.25%
            </label>
          </div>

          <Input
            type="date"
            name="dueDate"
            label="Date d'échéance"
          />

          <Button type="submit">
            Générer la facture
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Tâche 6.2 : Clients Panel avec Stats** (3h)
```tsx
// client/src/components/operations/clients-panel.tsx

export function ClientsPanel() {
  const clients = ["MAERSK", "CNPCC", "AGL", "SODECOTON"];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {clients.map(client => (
        <ClientCard key={client} clientName={client} />
      ))}
    </div>
  );
}

function ClientCard({ clientName }: { clientName: string }) {
  const { data: clientData } = useQuery({
    queryKey: ["/api/operations/by-client", clientName],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{clientName}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Missions</span>
            <span className="font-semibold">
              {clientData?.statistics.totalMissions || 0}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Carburant</span>
            <span className="font-semibold">
              {formatNumber(clientData?.statistics.totalFuelConsumed || 0)} L
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">CA</span>
            <span className="font-semibold text-green-600">
              {formatNumber(clientData?.statistics.totalRevenue || 0)} FCFA
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Marge</span>
            <span className="font-semibold text-purple-600">
              {clientData?.statistics.marginPercentage?.toFixed(1)}%
            </span>
          </div>
        </div>

        <Button
          className="w-full mt-4"
          variant="outline"
          onClick={() => exportClientOperations(clientName)}
        >
          📊 Export Excel
        </Button>
      </CardContent>
    </Card>
  );
}
```

#### **JOUR 7-8 : Exports & Rapports** (12h)

**Tâche 7.1 : Export Center** (4h)
```tsx
// client/src/pages/exports/reports.tsx

export default function ReportsCenter() {
  return (
    <div>
      <PageHeader
        title="Centre d'Export & Rapports"
        subtitle="Exports Excel et rapports comptables"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Export Factures Fournisseurs */}
        <ExportCard
          title="Factures Fournisseurs"
          description="96 factures importées"
          icon="file-text"
          endpoint="/api/exports/supplier-invoices"
          filename="factures_fournisseurs.xlsx"
        />

        {/* Export Inventaire */}
        <ExportCard
          title="Inventaire Stock"
          description="58 pièces - 94.4M FCFA"
          icon="package"
          endpoint="/api/exports/inventory"
          filename="inventaire_stock.xlsx"
        />

        {/* Export Carburant */}
        <ExportCard
          title="Consommation Carburant"
          description="Avec filtres période"
          icon="fuel"
          endpoint="/api/exports/fuel-consumption"
          filename="carburant.xlsx"
          withFilters={true}
        />

        {/* Export Opérations */}
        <ExportCard
          title="Opérations Clients"
          description="MAERSK, CNPCC, AGL, SODECOTON"
          icon="truck"
          endpoint="/api/exports/client-operations"
          filename="operations_clients.xlsx"
          withFilters={true}
        />

        {/* Rapport Mensuel Complet */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📊 Rapport Comptable Mensuel
            </CardTitle>
            <CardDescription>
              Export consolidé : fournisseurs, clients, carburant, stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyReportForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExportCard({ title, description, icon, endpoint, filename, withFilters }: any) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(endpoint);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      
      toast({ title: "Export réussi", description: `${filename} téléchargé` });
    } catch (error) {
      toast({
        title: "Erreur d'export",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {icon === "file-text" && <FileText className="w-5 h-5" />}
          {icon === "package" && <Package className="w-5 h-5" />}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {withFilters ? (
          <ExportWithFilters endpoint={endpoint} filename={filename} />
        ) : (
          <Button
            className="w-full"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? "Export en cours..." : "📥 Exporter Excel"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

**Tâche 7.2 : Monthly Report Generator** (4h)
```tsx
// client/src/components/exports/monthly-report-form.tsx

export function MonthlyReportForm() {
  const [year, setYear] = useState(2025);
  const [month, setMonth] = useState(8);

  const handleGenerate = async () => {
    try {
      const response = await fetch(
        `/api/exports/monthly-report?year=${year}&month=${month}`
      );
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_comptable_${month}_${year}.xlsx`;
      a.click();
      
      toast({
        title: "Rapport généré",
        description: `Rapport comptable ${month}/${year} téléchargé`
      });
    } catch (error) {
      toast({
        title: "Erreur",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Année</Label>
          <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2024">2024</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Mois</Label>
          <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={(i + 1).toString()}>
                  {new Date(2025, i, 1).toLocaleDateString('fr-FR', { month: 'long' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-950 rounded p-4">
        <h4 className="font-semibold mb-2">Contenu du rapport :</h4>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>✅ Synthèse générale du mois</li>
          <li>✅ Factures fournisseurs</li>
          <li>✅ Factures clients</li>
          <li>✅ Consommation carburant</li>
          <li>✅ Mouvements stock</li>
        </ul>
      </div>

      <Button className="w-full" onClick={handleGenerate}>
        📊 Générer Rapport Complet
      </Button>
    </div>
  );
}
```

**Tâche 7.3 : Tests e2e Exports** (4h)
- Test export factures fournisseurs
- Test export inventaire
- Test export carburant
- Test rapport mensuel
- Validation formats Excel

---

### **JOUR 9-10 : Intégration & Tests Complets** 🟡

#### **JOUR 9 : Intégration Dashboards** (6h)

**Tâche 9.1 : Enrichir Dashboard Logisticien** (3h)
- Ajouter panel missions par destination
- Intégrer facturation clients
- Lien vers exports Excel

**Tâche 9.2 : Enrichir Dashboard Secrétaire** (3h)
- Ajouter suivi factures clients
- Panel paiements reçus
- Exports rapports comptables

#### **JOUR 10 : Tests End-to-End Sprint 4** (6h)

**Tâche 10.1 : Tests Flux Opérations** (3h)
```
Test Scenario:
1. Créer mission depuis enregistrement carburant
2. Générer facture client
3. Enregistrer paiement
4. Vérifier statistiques mises à jour
5. Exporter rapport client
```

**Tâche 10.2 : Tests Flux Exports** (3h)
```
Test Scenario:
1. Export factures fournisseurs (96)
2. Export inventaire (58 pièces)
3. Export carburant août 2025 (24)
4. Export opérations MAERSK
5. Rapport mensuel complet
6. Vérifier formats Excel corrects
```

---

### **JOUR 11-12 : Finalisation & Documentation** 🟢

#### **JOUR 11 : Corrections & Optimisations** (6h)

**Tâche 11.1 : Corrections Bugs** (3h)
- Fixer bugs identifiés en tests
- Optimiser performances queries
- Améliorer UX formulaires

**Tâche 11.2 : Validations Finales** (3h)
- Vérifier calculs TVA 19.25%
- Valider totaux rapports
- Tester tous les exports

#### **JOUR 12 : Documentation & Déploiement** (6h)

**Tâche 12.1 : Documentation Technique** (3h)
- API documentation complète
- Guide utilisation exports
- Manuel facturation clients

**Tâche 12.2 : Préparation Production** (3h)
- Tests intégration finale
- Validation données réelles
- Checklist déploiement

---

## 📊 DONNÉES RÉELLES EXPLOITÉES

### **Carburant (Base Missions)**
- ✅ 24 enregistrements août 2025
- ✅ 3 recharges : 24 778 056 FCFA
- ✅ 21 consommations : 10 660 344 FCFA
- ✅ Solde : 14 117 712 FCFA

### **Clients Identifiés**
- ✅ MAERSK (présent dans fuelRecords)
- ✅ CNPCC (présent dans fuelRecords)
- ✅ AGL (présent dans fuelRecords)
- ✅ SODECOTON (présent dans fuelRecords)

### **Destinations Réelles**
- ✅ NDJAMENA
- ✅ DLA-NDERE
- ✅ TOUBORO

### **Véhicules Disponibles**
- ✅ 27 véhicules opérationnels
- ✅ Données kilométrage disponibles
- ✅ Prix achat pour amortissement

---

## 🎯 LIVRABLES SPRINT 4

### **Services Backend**
1. ✅ operations-service.ts (Gestion missions)
2. ✅ client-billing-service.ts (Facturation)
3. ✅ excel-export-service.ts (Exports)

### **APIs REST**
1. ✅ /api/operations/* (8 endpoints)
2. ✅ /api/billing/* (6 endpoints)
3. ✅ /api/exports/* (5 endpoints)

### **Composants Frontend**
1. ✅ Operations Dashboard
2. ✅ Mission Form
3. ✅ Client Invoice Generator
4. ✅ Export Center
5. ✅ Report Generator

### **Exports Excel**
1. ✅ Factures fournisseurs (96)
2. ✅ Inventaire stock (58 pièces)
3. ✅ Consommation carburant
4. ✅ Opérations clients
5. ✅ Rapport comptable mensuel

---

## ✅ CRITÈRES DE SUCCÈS SPRINT 4

### **Backend**
- ✅ Service Opérations créant missions depuis carburant
- ✅ Service Facturation avec TVA 19.25%
- ✅ Service Exports Excel fonctionnel
- ✅ Tous calculs validés avec données réelles

### **Frontend**
- ✅ Dashboard opérations complet
- ✅ Création missions intuitive
- ✅ Facturation clients automatique
- ✅ Centre exports accessible

### **Intégration**
- ✅ Flux mission → facture → paiement complet
- ✅ Tous exports Excel fonctionnels
- ✅ Rapport mensuel consolidé
- ✅ Tests e2e passants

### **Données**
- ✅ 24 enregistrements carburant exploités
- ✅ 4 clients actifs (MAERSK, CNPCC, AGL, SODECOTON)
- ✅ 3 destinations principales
- ✅ Calculs coûts/marges précis

---

## 🎉 CONCLUSION PHASE 2

### **Sprint 4 = Sprint Final Phase 2**

Ce sprint complète la **Phase 2** en ajoutant :
- Module opérations & facturation clients
- Système exports Excel complet
- Rapports comptables automatisés

### **Récapitulatif Phase 2 Complète**

**Sprint 1** : Services Stock + Carburant + TVA ✅  
**Sprint 2** : Dashboards Magasinier + Logisticien + Secrétaire ✅  
**Sprint 3** : Services Véhicules + CPC + Charts ✅  
**Sprint 4** : Opérations + Facturation + Exports ✅

### **Données Réelles Totalement Exploitées**
- ✅ 96 factures fournisseurs (12 fournisseurs)
- ✅ 58 pièces stock (94,4M FCFA)
- ✅ 24 enregistrements carburant (14,1M FCFA)
- ✅ 27 véhicules + documentation
- ✅ 27 chauffeurs + CPC
- ✅ 4 clients actifs

### **Prêt pour Phase 3**
- ✅ Base solide exploitation données
- ✅ Services métier complets
- ✅ Dashboards opérationnels
- ✅ Exports & rapports automatisés

**Phase 3 à venir :** Optimisations, mobile, analytics avancés

---

**Durée Sprint 4 :** 12 jours  
**Équipe requise :** 2-3 développeurs full-stack  
**Technologies :** Node.js, React, Drizzle ORM, XLSX  

*Document créé - 6 octobre 2025*  
*Sprint 4 : Opérations, Facturation Clients & Exports Excel*
