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
import {
  laborCatalogRoutes,
  laborCatalogWriteRoutes,
  workOrderItemDetailRoutes,
  workOrderItemsRoutes,
} from "./work-order-items.routes";
import partRequirementsRoutes from "./part-requirements.routes";
import documentRenewalsRoutes from "./document-renewals.routes";
import managementRoutes from "./management.routes";
import featureFlagsRoutes from "./feature-flags.routes";
import vehicleDocumentTypesRoutes from "./vehicle-document-types.routes";
import authLockoutRoutes from "./auth-lockout.routes";
import auditLogsRoutes from "./audit-logs.routes";
import backupsRoutes from "./backups.routes";
import workOrderExportRoutes from "./work-order-export.routes";
import notificationSettingsRoutes from "./notification-settings.routes";
import kpiRoutes from "./kpi.routes";
import workOrderAuditTrailRoutes from "./work-order-audit-trail.routes";
import vehicleCostSummaryRoutes from "./vehicle-cost-summary.routes";
import tireMovementsRoutes from "./tire-movements.routes";
import partRequirementReceiveRoutes from "./part-requirement-receive.routes";
import fuelAnomaliesRoutes from "./fuel-anomalies.routes";
import fuelVouchersRoutes from "./fuel-vouchers.routes";
import fuelPricesRoutes from "./fuel-prices.routes";
import timeTrackingRoutes from "./time-tracking.routes";
import pendingInvoicesRoutes from "./pending-invoices.routes";
import incidentsRoutes from "./incidents.routes";
import qualityCheckRoutes from "./quality-check.routes";
import authCaptchaRoutes from "./auth-captcha.routes";
import missionAdvisoriesRoutes from "./mission-advisories.routes";
import partScansRoutes from "./part-scans.routes";
import partSalesRoutes from "./part-sales.routes";
import telemetryRoutes from "./telemetry.routes";
import vehiclePositionsRoutes from "./vehicle-positions.routes";
import telemetryDevicesRoutes from "./telemetry-devices.routes";
import workshopLaborRatesRoutes from "./workshop-labor-rates.routes";
import maintenanceReportsRoutes from "./maintenance-reports.routes";
import importsRoutes from "./imports.routes";
import { workOrderBookingGuard } from "../middleware/booking-guard";
import vehicleDocumentsRoutes from "./vehicle-documents.routes";
import { loginLockoutGuard } from "../middleware/login-lockout-guard";
import { captchaGuard } from "../middleware/captcha-guard";
import { auditWrites } from "../middleware/audit-writes";
import { AUDIT_CONFIG, CDC_AUDIT_CONFIG } from "../lib/audit-config";
import { idempotencyGuard } from "../middleware/idempotency-guard";
import { requireFeature } from "../lib/feature-flags";
import { DbLockoutStore, PASSWORD_KEY_PREFIX, PIN_KEY_PREFIX } from "../services/login-lockout-db-store";

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

  // Gardes de connexion (T-12, T-48) : montes ici car /api est servi AVANT registerRoutes
  // (server/app.ts), donc avant les handlers de login de server/routes.ts. Le corps est deja
  // analyse en amont (express.json dans app.ts). Verrouillage d'abord, captcha ensuite.
  const lockoutStore = new DbLockoutStore();
  const failedCountOf = (prefix: string) => async (username: string) => (await lockoutStore.get(prefix + username)).failedCount;
  apiRouter.post(
    "/auth/login",
    loginLockoutGuard({ store: lockoutStore, keyPrefix: PASSWORD_KEY_PREFIX }),
    captchaGuard({ getFailedCount: failedCountOf(PASSWORD_KEY_PREFIX) }),
  );
  apiRouter.post(
    "/auth/pin-login",
    loginLockoutGuard({ store: lockoutStore, usernameField: "userId", keyPrefix: PIN_KEY_PREFIX }),
    captchaGuard({ getFailedCount: failedCountOf(PIN_KEY_PREFIX), usernameField: "userId" }),
  );
  // Journal d'audit des ecritures, apres la session (req.user connu).
  apiRouter.use(auditWrites(AUDIT_CONFIG));
  // Ressources du chantier CDC : liste d'audit separee (AUDIT_CONFIG est gelee par un test).
  apiRouter.use(auditWrites(CDC_AUDIT_CONFIG));
  // Idempotence des ecritures rejouables (CDC #10) : squelette sans effet, drapeau
  // `technician-offline` et liste vide (lot #10b).
  apiRouter.use(idempotencyGuard());

  // EXCEPTION AUX GARDES DE SESSION (CDC #6) : `/telemetry` recoit les positions des boitiers GPS,
  // qui n'ont pas de compte et s'authentifieront par jeton d'appareil (lot #6). Monte ici, avant
  // tout routeur garde, pour qu'aucune garde de session ajoutee plus bas ne le capture. Derriere
  // le drapeau `gps` (404 coupe). Le squelette repond 501 sans rien lire ni ecrire.
  apiRouter.use("/telemetry", requireFeature("gps"), telemetryRoutes);

  // Monter les routes de chaque service
  // Session is now properly propagated to all these routes
  apiRouter.use("/warehouse", isStaff, warehouseRoutes);
  apiRouter.use("/fuel-card", isStaff, fuelCardRoutes);
  apiRouter.use("/vehicles", vehiclesRoutes);
  apiRouter.use("/drivers", isStaff, driversRoutes);
  apiRouter.use("/drivers", isStaff, driversManagementRoutes);
  // Garde au montage: aucune route du routeur missions ne se protégeait seule.
  apiRouter.use("/missions", authenticate, isStaff, missionsRoutes);
  apiRouter.use("/clients", isStaff, clientsRoutes);
  apiRouter.use("/operations", isStaff, operationsRoutes);
  apiRouter.use("/billing", billingRoutes);
  apiRouter.use("/exports", ...exportsGuard, exportsRoutes);
  // Approvisionnement: garde au montage plutôt que route par route, pour
  // qu'une route ajoutée plus tard soit couverte d'office. Le chef d'atelier
  // et le technicien demandent des pièces, ils ne passent pas les commandes —
  // c'est déjà ce que dit le menu, ce n'était pas ce qu'appliquait l'API.
  const gardeApprovisionnement = authorize([...PROCUREMENT_ROLES]);
  apiRouter.use("/suppliers", gardeApprovisionnement, suppliersRoutes);
  apiRouter.use("/purchase-orders", gardeApprovisionnement, purchaseOrdersRoutes);
  apiRouter.use("/supplier-invoices", gardeApprovisionnement, supplierInvoicesRoutes);
  // Double affectation (T-23b) : avant tout routeur /work-orders, y compris les historiques.
  apiRouter.use("/work-orders", workOrderBookingGuard);
  apiRouter.use("/work-orders", workOrderPartsRoutes);
  apiRouter.use("/work-orders", workOrderItemsRoutes);
  // Lignes de travail: préfixes dédiés, donc garde au montage — toute route
  // ajoutée plus tard dans ces routeurs est couverte d'office.
  apiRouter.use("/work-order-items", isTechnician, workOrderItemDetailRoutes);
  apiRouter.use("/labor-catalog", laborCatalogRoutes);
  apiRouter.use("/labor-catalog", isWorkshopManager, laborCatalogWriteRoutes);
  apiRouter.use("/part-requirements", isStaff, partRequirementsRoutes);
  apiRouter.use("/document-renewals", documentRenewalsRoutes);
  apiRouter.use("/management", managementRoutes);

  // Ressources du chantier CDC (lot CDC-0a). Squelettes 501 que chaque lot remplace dans son
  // propre fichier. Ordre des gardes au montage : drapeau (404), session et role (401, 403).
  // Aucun de ces chemins n'existe dans server/routes.ts ni dans un autre routeur (verifie).
  apiRouter.use(
    "/mission-advisories",
    requireFeature("mission-maintenance-advisory"),
    authorize([...MISSION_ADVISORY_ROLES]),
    missionAdvisoriesRoutes,
  );
  apiRouter.use("/part-scans", requireFeature("part-qr"), authorize([...PART_SCAN_ROLES]), partScansRoutes);
  // Vente de pieces (provisoire, decision utilisateur #4) : la direction lit, seuls
  // PART_SALE_ROLES ecrivent.
  const partSaleWriteGuard = authorize([...PART_SALE_ROLES]);
  apiRouter.use(
    "/part-sales",
    requireFeature("part-sales"),
    authorize([...PART_SALE_READ_ROLES]),
    (req, res, next) => (req.method === "GET" || req.method === "HEAD" ? next() : partSaleWriteGuard(req, res, next)),
    partSalesRoutes,
  );
  apiRouter.use("/vehicle-positions", requireFeature("gps"), authorize([...GPS_VIEW_ROLES]), vehiclePositionsRoutes);
  apiRouter.use("/admin/telemetry-devices", requireFeature("gps"), isAdmin, telemetryDevicesRoutes);
  apiRouter.use("/workshop-labor-rates", requireFeature("maintenance-report"), isAdmin, workshopLaborRatesRoutes);
  apiRouter.use(
    "/maintenance-reports",
    requireFeature("exports"),
    requireFeature("maintenance-report"),
    authorize([...MAINTENANCE_REPORT_ROLES]),
    maintenanceReportsRoutes,
  );
  // Le chef d'atelier n'importe que des interventions : les autres imports sont reserves a
  // l'administrateur par la garde de leur route (IMPORT_ROLES).
  apiRouter.use("/imports", requireFeature("excel-import"), authorize([...IMPORT_INTERVENTION_ROLES]), importsRoutes);

  // Routeurs du lot recette (T-08). Chemins relatifs à /api, déclarés dans chaque fichier :
  // squelettes 501 derrière leur drapeau, que chaque agent remplace sans toucher à ce fichier.
  // Montés après les routeurs historiques : aucun chemin existant n'est masqué.
  apiRouter.use(featureFlagsRoutes);
  apiRouter.use(vehicleDocumentTypesRoutes);
  apiRouter.use(authLockoutRoutes);
  apiRouter.use(auditLogsRoutes);
  apiRouter.use(backupsRoutes);
  apiRouter.use(workOrderExportRoutes);
  apiRouter.use(notificationSettingsRoutes);
  apiRouter.use(kpiRoutes);
  apiRouter.use(workOrderAuditTrailRoutes);
  apiRouter.use(vehicleCostSummaryRoutes);
  apiRouter.use(tireMovementsRoutes);
  apiRouter.use(partRequirementReceiveRoutes);
  apiRouter.use(fuelAnomaliesRoutes);
  apiRouter.use(fuelVouchersRoutes);
  apiRouter.use(fuelPricesRoutes);
  apiRouter.use(timeTrackingRoutes);
  apiRouter.use(pendingInvoicesRoutes);
  apiRouter.use(incidentsRoutes);
  apiRouter.use(qualityCheckRoutes);
  apiRouter.use(authCaptchaRoutes);
  apiRouter.use(vehicleDocumentsRoutes);

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
import { authenticate, authorize, isAdmin, isStaff, isTechnician, isWorkshopManager } from "../middleware/auth";
import { exportsGuard } from "../middleware/exports-guard";
import {
  GPS_VIEW_ROLES,
  IMPORT_INTERVENTION_ROLES,
  MAINTENANCE_REPORT_ROLES,
  MISSION_ADVISORY_ROLES,
  PART_SALE_READ_ROLES,
  PART_SALE_ROLES,
  PART_SCAN_ROLES,
  PROCUREMENT_ROLES,
} from "@shared/constants/roles";
export default createApiRouter(sessionMiddleware);
