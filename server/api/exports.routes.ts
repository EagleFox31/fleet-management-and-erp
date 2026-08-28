import { Router, Request, Response } from "express";
import { excelExportService } from "../services/excel-export-service";
import { authenticate } from "../middleware/auth";

const router = Router();

/**
 * Routes API Exports Excel
 * 
 * Endpoints:
 * - GET /api/exports/supplier-invoices - Export factures fournisseurs (96 factures)
 * - GET /api/exports/inventory - Export inventaire stock (58 pièces, 94.4M FCFA)
 * - GET /api/exports/fuel-consumption - Export consommation carburant
 * - GET /api/exports/client-operations - Export missions clients
 * - GET /api/exports/client-invoices - Export factures clients
 * - GET /api/exports/monthly-report - Rapport comptable mensuel complet
 */

/**
 * GET /api/exports/supplier-invoices
 * Export Excel: Factures fournisseurs (96 factures)
 */
router.get("/supplier-invoices", authenticate, async (req: Request, res: Response) => {
  try {
    const buffer = await excelExportService.exportSupplierInvoices();
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=factures_fournisseurs_${new Date().toISOString().split('T')[0]}.xlsx`
    );
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting supplier invoices:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/inventory
 * Export Excel: Inventaire stock (58 pièces, 94.4M FCFA)
 */
router.get("/inventory", authenticate, async (req: Request, res: Response) => {
  try {
    const buffer = await excelExportService.exportInventory();
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=inventaire_stock_${new Date().toISOString().split('T')[0]}.xlsx`
    );
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting inventory:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/fuel-consumption
 * Export Excel: Consommation carburant (24 enregistrements août 2025)
 * Query params: year (required), month (optional)
 */
router.get("/fuel-consumption", authenticate, async (req: Request, res: Response) => {
  try {
    const { year, month } = req.query;

    if (!year) {
      return res.status(400).json({ error: "year est requis" });
    }

    const buffer = await excelExportService.exportFuelConsumption(
      parseInt(year as string),
      month ? parseInt(month as string) : undefined
    );
    
    const filename = month
      ? `carburant_${month}_${year}.xlsx`
      : `carburant_${year}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting fuel consumption:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/client-operations
 * Export Excel: Missions et opérations clients
 * Query params: clientName (optional)
 */
router.get("/client-operations", authenticate, async (req: Request, res: Response) => {
  try {
    const { clientName } = req.query;

    const buffer = await excelExportService.exportClientOperations(
      clientName as string | undefined
    );
    
    const filename = clientName
      ? `operations_${clientName}_${new Date().toISOString().split('T')[0]}.xlsx`
      : `operations_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting client operations:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/client-invoices
 * Export Excel: Factures clients
 * Query params: clientName (optional)
 */
router.get("/client-invoices", authenticate, async (req: Request, res: Response) => {
  try {
    const { clientName } = req.query;

    const buffer = await excelExportService.exportClientInvoices(
      clientName as string | undefined
    );
    
    const filename = clientName
      ? `factures_${clientName}_${new Date().toISOString().split('T')[0]}.xlsx`
      : `factures_clients_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting client invoices:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/monthly-report
 * Export Excel: Rapport comptable mensuel complet
 * Query params: year (required), month (required)
 */
router.get("/monthly-report", authenticate, async (req: Request, res: Response) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ error: "year et month sont requis" });
    }

    const buffer = await excelExportService.exportMonthlyAccountingReport(
      parseInt(year as string),
      parseInt(month as string)
    );
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=rapport_mensuel_${month}_${year}.xlsx`
    );
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting monthly report:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/fuel-statistics
 * Alias vers /api/exports/fuel-consumption
 */
router.get("/fuel-statistics", authenticate, async (req: Request, res: Response) => {
  try {
    const { year, month } = req.query;

    if (!year) {
      return res.status(400).json({ error: "year est requis" });
    }

    const buffer = await excelExportService.exportFuelConsumption(
      parseInt(year as string),
      month ? parseInt(month as string) : undefined
    );
    
    const filename = month
      ? `stats_carburant_${month}_${year}.xlsx`
      : `stats_carburant_${year}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting fuel statistics:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/exports/client-missions
 * Alias vers /api/exports/client-operations
 */
router.get("/client-missions", authenticate, async (req: Request, res: Response) => {
  try {
    const { client } = req.query;

    const buffer = await excelExportService.exportClientOperations(
      client as string | undefined
    );
    
    const filename = client
      ? `missions_${client}_${new Date().toISOString().split('T')[0]}.xlsx`
      : `missions_tous_clients_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    
    res.send(buffer);
  } catch (error: any) {
    console.error("Error exporting client missions:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
