import { Router, RequestHandler } from "express";
import warehouseRoutes from "./warehouse.routes";
import fuelCardRoutes from "./fuel-card.routes";
import vehiclesRoutes from "./vehicles.routes";
import driversRoutes from "./drivers.routes";
import driversManagementRoutes from "./drivers-management.routes";
import missionsRoutes from "./missions.routes";
import clientsRoutes from "./clients.routes";
import operationsRoutes from "./operations.routes";
import billingRoutes from "./billing.routes";
import exportsRoutes from "./exports.routes";
import suppliersRoutes from "./suppliers.routes";
import purchaseOrdersRoutes from "./purchase-orders.routes";
import supplierInvoicesRoutes from "./supplier-invoices.routes";
import workOrderPartsRoutes from "./work-order-parts.routes";
import partRequirementsRoutes from "./part-requirements.routes";
import documentRenewalsRoutes from "./document-renewals.routes";

/**
 * Router API Factory - Phase 2 Sprint 3
 * 
 * Architecture modulaire avec routes séparées par service
 * 
 * IMPORTANT: Session middleware MUST be applied BEFORE mounting sub-routes
 * This factory pattern ensures proper session propagation to all modular routes
 */

export function createApiRouter(sessionMiddleware: RequestHandler): Router {
  const apiRouter = Router();

  // Apply session middleware FIRST, before any routes are mounted
  // This ensures req.session.userId is available in all sub-routes
  apiRouter.use(sessionMiddleware);

  // Monter les routes de chaque service
  // Session is now properly propagated to all these routes
  apiRouter.use("/warehouse", warehouseRoutes);
  apiRouter.use("/fuel-card", fuelCardRoutes);
  apiRouter.use("/vehicles", vehiclesRoutes);
  apiRouter.use("/drivers", driversRoutes);
  apiRouter.use("/drivers", driversManagementRoutes);
  apiRouter.use("/missions", missionsRoutes);
  apiRouter.use("/clients", clientsRoutes);
  apiRouter.use("/operations", operationsRoutes);
  apiRouter.use("/billing", billingRoutes);
  apiRouter.use("/exports", exportsRoutes);
  apiRouter.use("/suppliers", suppliersRoutes);
  apiRouter.use("/purchase-orders", purchaseOrdersRoutes);
  apiRouter.use("/supplier-invoices", supplierInvoicesRoutes);
  apiRouter.use("/work-orders", workOrderPartsRoutes);
  apiRouter.use("/part-requirements", partRequirementsRoutes);
  apiRouter.use("/document-renewals", documentRenewalsRoutes);

  // Note: Legacy billing routes (/api/suppliers/*, /api/invoices/*) are in server/routes.ts
  // for backward compatibility. New billing features use /api/billing/*

  // Route de santé pour l'API
  apiRouter.get("/health", (_req, res) => {
    res.status(200).json({ 
      status: "ok",
      message: "Yaro FleetOS API - MVP Phase 1 (Fournisseurs & Procurement)",
      services: {
        warehouse: "Stock & Alertes (58 pièces - 94,4M FCFA)",
        fuelCard: "Carte Rechargeable (24 enregistrements - 14,1M FCFA)",
        vehicles: "Documentation & Maintenance (27 véhicules)",
        drivers: "CPC & Formations (27 chauffeurs)",
        missions: "Gestion Missions Transport",
        clients: "Gestion Clients (MAERSK, CNPCC, etc.)",
        operations: "Opérations & Missions Clients",
        billing: "Facturation Clients (TVA 19.25%)",
        exports: "Exports Excel (Inventaire, Carburant, Factures)",
        suppliers: "Gestion Fournisseurs & Évaluations Performance (MVP Phase 1)",
        purchaseOrders: "Commandes Groupées & Optimisation Achats (Phase 1.1.2)",
        supplierInvoices: "Factures Fournisseurs & Contrôle 3 Voies (Phase 1.1.3)"
      },
      note: "MVP Phase 1 en cours - Module Procurement avec commandes groupées pour économies 5-10%"
    });
  });

  return apiRouter;
}

// For backward compatibility, export a default router created with default session
// This will be replaced by the factory-created router in registerRoutes
import { sessionMiddleware } from "../middleware/session";
export default createApiRouter(sessionMiddleware);
