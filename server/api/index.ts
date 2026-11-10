import { Router, RequestHandler, type Request, type Response, type NextFunction } from "express";
import warehouseRoutes from "./warehouse.routes";
import fuelCardRoutes from "./fuel-card.routes";
import vehiclesRoutes from "./vehicles.routes";
import vehicleLifecycleRoutes from "./vehicle-lifecycle.routes";
import vehicleSubresourcesRoutes from "./vehicle-subresources.routes";
import driversRoutes from "./drivers.routes";
import driversManagementRoutes from "./drivers-management.routes";
import missionsRoutes from "./missions.routes";
import missionPriceRoutes from "./mission-price.routes";
import fuelRecordsRoutes from "./fuel-records.routes";
import vehicleHistoryRoutes from "./vehicle-history.routes";
import clientsRoutes from "./clients.routes";
import operationsRoutes from "./operations.routes";
import billingRoutes from "./billing.routes";
import exportsRoutes from "./exports.routes";
import suppliersRoutes from "./suppliers.routes";
import purchaseOrdersRoutes from "./purchase-orders.routes";
import supplierInvoicesRoutes from "./supplier-invoices.routes";
import workOrderPartsRoutes from "./work-order-parts.routes";
import partsUsedRoutes from "./parts-used.routes";
import {
  laborCatalogRoutes,
  laborCatalogWriteRoutes,
  workOrderItemDetailRoutes,
  workOrderItemsRoutes,
} from "./work-order-items.routes";
import { workOrderLaborRateRoutes } from "./work-order-labor-rate.routes";
import partRequirementsRoutes from "./part-requirements.routes";
import documentRenewalsRoutes from "./document-renewals.routes";
import documentRenewalCentersRoutes from "./document-renewal-centers.routes";
import managementRoutes from "./management.routes";
import featureFlagsRoutes from "./feature-flags.routes";
import vehicleDocumentTypesRoutes from "./vehicle-document-types.routes";
import authLockoutRoutes from "./auth-lockout.routes";
import pinAuthRoutes from "./pin-auth.routes";
import partsCatalogRoutes from "./parts-catalog.routes";
import faultCatalogRoutes from "./fault-catalog.routes";
import tireRotationsRoutes from "./tire-rotations.routes";
import adminUsersGuardRoutes from "./admin-users-guard.routes";
import statisticsCostGuardRoutes from "./statistics-cost-guard.routes";
import moneyReadsRoutes from "./money-reads.routes";
import stockValuationGuardRoutes from "./stock-valuation-guard.routes";
import lastAdminGuardRoutes from "./last-admin-guard.routes";
import workflowsRoutes from "./workflows.routes";
import auditLogsRoutes from "./audit-logs.routes";
import backupsRoutes from "./backups.routes";
import adminImportBackupRoutes from "./admin-import-backup.routes";
import workOrderExportRoutes from "./work-order-export.routes";
import notificationSettingsRoutes from "./notification-settings.routes";
import alertsRoutes from "./alerts.routes";
import kpiRoutes from "./kpi.routes";
import workOrderAuditTrailRoutes from "./work-order-audit-trail.routes";
import vehicleCostSummaryRoutes from "./vehicle-cost-summary.routes";
import tireMovementsRoutes from "./tire-movements.routes";
import partRequirementReceiveRoutes from "./part-requirement-receive.routes";
import fuelAnomaliesRoutes from "./fuel-anomalies.routes";
import fuelVouchersRoutes from "./fuel-vouchers.routes";
import fuelPricesRoutes from "./fuel-prices.routes";
import missionBudgetsRoutes from "./mission-budgets.routes";
import timeTrackingRoutes from "./time-tracking.routes";
import pendingInvoicesRoutes from "./pending-invoices.routes";
import financeReceivablesRoutes from "./finance-receivables.routes";
import clientStatementRoutes from "./client-statement.routes";
import missionOperationsRoutes from "./mission-operations.routes";
import tariffGridRoutes from "./tariff-grid.routes";
import treasuryRoutes from "./treasury.routes";
import cappedStatisticsRoutes from "./capped-statistics.routes";
import paymentInstrumentsRoutes from "./payment-instruments.routes";
import incidentsRoutes from "./incidents.routes";
import driverBreakdownsRoutes from "./driver-breakdowns.routes";
import qhseInspectionsRoutes from "./qhse-inspections.routes";
import qualityCheckRoutes from "./quality-check.routes";
import missionAdvisoriesRoutes from "./mission-advisories.routes";
import partScansRoutes from "./part-scans.routes";
import partSalesRoutes from "./part-sales.routes";
import telemetryRoutes from "./telemetry.routes";
import vehiclePositionsRoutes from "./vehicle-positions.routes";
import telemetryDevicesRoutes from "./telemetry-devices.routes";
import workshopLaborRatesRoutes from "./workshop-labor-rates.routes";
import maintenanceReportsRoutes from "./maintenance-reports.routes";
import importsRoutes from "./imports.routes";
import technicianWorkOrdersRoutes from "./technician-work-orders.routes";
import userStockPermissionRoutes from "./user-stock-permission.routes";
import { workOrderBookingGuard } from "../middleware/booking-guard";
import { workOrderCostMask } from "../lib/work-order-cost-mask";
import { partPriceMask } from "../lib/part-price-scope";
import vehicleDocumentsRoutes from "./vehicle-documents.routes";
import uploadedDocumentsRoutes from "./uploaded-documents.routes";
import { loginLockoutGuard } from "../middleware/login-lockout-guard";
import { routeIdRangeGuard } from "../middleware/route-id-range-guard";
import { validateBody } from "../middleware/validate-body";
import { pinLoginRequestSchema } from "@shared/contracts/auth-pin-login";
import { LOGIN_BODY_INVALID_MESSAGE, loginRequestSchema } from "@shared/contracts/auth-login";
import { auditWrites } from "../middleware/audit-writes";
import { AUDIT_CONFIG, CDC_AUDIT_CONFIG } from "../lib/audit-config";
import { idempotencyGuard } from "../middleware/idempotency-guard";
import { retiredVehicleWriteGuard } from "../middleware/retired-vehicle-write-guard";
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
  // Id hors int4 refusé avant toute route /api (server/api puis routes.ts, servi après) : sinon erreur base 22003 et 500.
  apiRouter.use(routeIdRangeGuard);

  // Apply session middleware FIRST, before any routes are mounted
  // This ensures req.session.userId is available in all sub-routes
  apiRouter.use(sessionMiddleware);

  // Coûts d'OT : retirés des lectures GET /api/work-orders/* pour les rôles hors
  // WORK_ORDER_COST_READ_ROLES. Monté avant tout routeur (vehicle-history, routes.ts compris).
  apiRouter.use("/work-orders", workOrderCostMask);
  // Prix des pièces : retirés des lectures GET /api/parts/* hors STOCK_VALUATION_READ_ROLES (chauffeur).
  apiRouter.use("/parts", partPriceMask);
  // Demandes de pièce : prix unitaire et coût estimé (quantité × prix), même périmètre.
  apiRouter.use("/part-requirements", partPriceMask);

  // Gardes de connexion (T-12, T-48) : montes ici car /api est servi AVANT registerRoutes
  // (server/app.ts), donc avant les handlers de login de server/routes.ts. Le corps est deja
  // analyse en amont (express.json dans app.ts).
  const lockoutStore = new DbLockoutStore();
  apiRouter.post(
    "/auth/login",
    // Corps validé AVANT le garde, comme pour le PIN : un corps invalide ne crée aucune ligne de
    // compteur et ne compte pas. Même 400 que le handler (server/routes.ts), qui revalide.
    (req, res, next) =>
      loginRequestSchema.safeParse(req.body).success ? next() : res.status(400).json({ message: LOGIN_BODY_INVALID_MESSAGE }),
    loginLockoutGuard({ store: lockoutStore, keyPrefix: PASSWORD_KEY_PREFIX }),
  );
  apiRouter.post(
    "/auth/pin-login",
    // Identifiant validé puis ramené à sa forme canonique AVANT le garde : "12", "012" et 12 = un seul compteur.
    validateBody(pinLoginRequestSchema),
    (req, _res, next) => {
      req.body.userId = String(Number(req.body.userId));
      next();
    },
    loginLockoutGuard({ store: lockoutStore, usernameField: "userId", keyPrefix: PIN_KEY_PREFIX }),
  );
  // Journal d'audit des ecritures, apres la session (req.user connu).
  apiRouter.use(auditWrites(AUDIT_CONFIG));
  // Ressources du chantier CDC : liste d'audit separee (AUDIT_CONFIG est gelee par un test).
  apiRouter.use(auditWrites(CDC_AUDIT_CONFIG));
  // Idempotence des ecritures rejouables (CDC #10b) : routes de IDEMPOTENCY_ROUTES, drapeau
  // `offline-writes` (coupe par defaut), apres la session (req.session.userId).
  apiRouter.use(idempotencyGuard());
  // Vehicule retire (L3) : ecritures rattachees refusees en 409 pour le personnel, table
  // RETIRED_VEHICLE_WRITE_ROUTES. Montee ici, avant registerRoutes : couvre aussi routes.ts.
  apiRouter.use(retiredVehicleWriteGuard);

  // `/telemetry` recevra les positions des boitiers GPS, qui n'ont pas de compte et
  // s'authentifieront par jeton d'appareil (lot #6). Tant que cette garde n'existe pas, le
  // squelette reste derriere `isAdmin` (garde de session marquee, posee en tete du routeur) : le garde-fou
  // tests/contract/api-auth-guard.contract.test.ts interdit toute route /api sans session.
  // Le lot #6 remplacera `isAdmin` par une garde jeton marquee (`isSessionGuard`) et ajoutera
  // l'exception justifiee a PUBLIC_ROUTES de ce test. Derriere le drapeau `gps` (404 coupe).
  apiRouter.use("/telemetry", requireFeature("gps"), telemetryRoutes);
  // Ecran PIN : un chauffeur desactive n'y figure plus et ne s'y connecte plus.
  apiRouter.use(pinAuthRoutes);
  // Catalogue pieces : creation et suppression (400/404/409 lisibles), avant routes.ts.
  apiRouter.use(partsCatalogRoutes);
  // Catalogue de pannes : valideur pose par le serveur, id inconnu -> 404.
  apiRouter.use(faultCatalogRoutes);
  apiRouter.use(tireRotationsRoutes);
  // Un admin ne se desactive pas lui-meme (garde, la route reste dans routes.ts).
  apiRouter.use(adminUsersGuardRoutes);
  apiRouter.use(lastAdminGuardRoutes);
  // Statistiques à montant (coût de maintenance, KPI de flotte) : gardes, les routes restent dans routes.ts.
  apiRouter.use(statisticsCostGuardRoutes);
  // Lectures argent/stock sorties de routes.ts : erreurs par le gestionnaire central (requestId).
  apiRouter.use(moneyReadsRoutes);
  // Statistiques OT, rapport d'inventaire, OT en attente de pièces : lectures complètes (plus de plafond à 50),
  // sorties de routes.ts. Monté avant tout routeur /work-orders pour que awaiting-parts passe avant /:id.
  apiRouter.use(cappedStatisticsRoutes);
  // Valuation du stock (/api/parts/statistics) : garde, la route reste dans routes.ts.
  apiRouter.use(stockValuationGuardRoutes);
  // Brouillon d'acquisition : liste blanche des champs, statut jamais lu du corps.
  // Fichiers téléversés : pièce jointe, nosniff, type en liste blanche (sortis de routes.ts).
  apiRouter.use(uploadedDocumentsRoutes);
  apiRouter.use(workflowsRoutes);
  // Suppression d'un plein : sous le verrou de la carte carburant, avant routes.ts.
  apiRouter.use(fuelRecordsRoutes);
  apiRouter.use(vehicleHistoryRoutes);

  // Monter les routes de chaque service
  // Session is now properly propagated to all these routes
  apiRouter.use("/warehouse", isStaff, warehouseRoutes);
  apiRouter.use("/fuel-card", isStaff, fuelCardRoutes);
  apiRouter.use("/vehicles", vehiclesRoutes);
  apiRouter.use("/vehicles", vehicleLifecycleRoutes);
  apiRouter.use("/vehicles", vehicleSubresourcesRoutes);
  apiRouter.use("/drivers", isStaff, driversRoutes);
  apiRouter.use("/drivers", isStaff, driversManagementRoutes);
  // Garde au montage: aucune route du routeur missions ne se protégeait seule.
  apiRouter.use("/missions", authenticate, isStaff, missionPriceRoutes);
  apiRouter.use("/missions", authenticate, isStaff, missionsRoutes);
  // Relevé client : avant /clients (isStaff), la cloison client et les rôles finance sont posés sur la route.
  apiRouter.use(clientStatementRoutes);
  apiRouter.use("/clients", isStaff, clientsRoutes);
  apiRouter.use("/operations", isStaff, operationsRoutes);
  apiRouter.use("/billing", billingRoutes);
  apiRouter.use("/exports", ...exportsGuard, exportsRoutes);
  // Approvisionnement: garde au montage plutôt que route par route, pour
  // qu'une route ajoutée plus tard soit couverte d'office. Le chef d'atelier
  // et le technicien demandent des pièces, ils ne passent pas les commandes —
  // c'est déjà ce que dit le menu, ce n'était pas ce qu'appliquait l'API.
  const gardeApprovisionnement = authorize([...PROCUREMENT_ROLES]);
  // Fournisseurs : le chef d'atelier consulte (GET), il n'écrit ni n'évalue.
  const gardeLectureFournisseurs = authorize([...SUPPLIER_READ_ROLES]);
  apiRouter.use(
    "/suppliers",
    // Marquée comme garde de session : chacune des deux gardes l'est, le répartiteur aussi.
    sessionGuard((req: Request, res: Response, next: NextFunction) =>
      (req.method === "GET" || req.method === "HEAD" ? gardeLectureFournisseurs : gardeApprovisionnement)(req, res, next),
    ),
    suppliersRoutes,
  );
  apiRouter.use("/purchase-orders", gardeApprovisionnement, purchaseOrdersRoutes);
  // Factures fournisseur : les profils d'approvisionnement plus le comptable (règlements).
  apiRouter.use("/supplier-invoices", authorize([...SUPPLIER_INVOICE_READ_ROLES]), supplierInvoicesRoutes);
  // Double affectation (T-23b) : avant tout routeur /work-orders, y compris les historiques.
  apiRouter.use("/work-orders", workOrderBookingGuard);
  apiRouter.use("/work-orders", workOrderPartsRoutes);
  // Pièces posées : liste (rôles coût) et retrait (magasin, atelier).
  apiRouter.use("/parts-used", partsUsedRoutes);
  apiRouter.use("/work-orders", workOrderItemsRoutes);
  apiRouter.use("/work-orders", workOrderLaborRateRoutes);
  // Lignes de travail: préfixes dédiés, donc garde au montage — toute route
  // ajoutée plus tard dans ces routeurs est couverte d'office.
  apiRouter.use("/work-order-items", isTechnician, workOrderItemDetailRoutes);
  apiRouter.use("/labor-catalog", laborCatalogRoutes);
  apiRouter.use("/labor-catalog", isWorkshopManager, laborCatalogWriteRoutes);
  apiRouter.use("/part-requirements", isStaff, partRequirementsRoutes);
  apiRouter.use("/document-renewals", documentRenewalsRoutes);
  // Écriture des centres (DOC1) : POST/PATCH /centers ; le GET reste dans le routeur ci-dessus.
  apiRouter.use("/document-renewals", documentRenewalCentersRoutes);
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
  apiRouter.use(adminImportBackupRoutes);
  apiRouter.use(workOrderExportRoutes);
  apiRouter.use(notificationSettingsRoutes);
  apiRouter.use(alertsRoutes);
  apiRouter.use(kpiRoutes);
  apiRouter.use(workOrderAuditTrailRoutes);
  apiRouter.use(vehicleCostSummaryRoutes);
  apiRouter.use(tireMovementsRoutes);
  apiRouter.use(partRequirementReceiveRoutes);
  apiRouter.use(fuelAnomaliesRoutes);
  apiRouter.use(fuelVouchersRoutes);
  apiRouter.use(fuelPricesRoutes);
  // Budget de mission (L1) : drapeau finance et rôles posés route par route.
  apiRouter.use(missionBudgetsRoutes);
  apiRouter.use(timeTrackingRoutes);
  apiRouter.use(pendingInvoicesRoutes);
  apiRouter.use(financeReceivablesRoutes);
  apiRouter.use(missionOperationsRoutes);
  apiRouter.use(tariffGridRoutes);
  apiRouter.use(treasuryRoutes);
  apiRouter.use(paymentInstrumentsRoutes);
  apiRouter.use(incidentsRoutes);
  apiRouter.use(driverBreakdownsRoutes);
  apiRouter.use(qhseInspectionsRoutes);
  apiRouter.use(qualityCheckRoutes);
  apiRouter.use(technicianWorkOrdersRoutes);
  apiRouter.use(userStockPermissionRoutes);
  apiRouter.use(vehicleDocumentsRoutes);

  // Fournisseurs : `suppliers.routes.ts` sert /api/suppliers/* (dont /summary, déclaré avant /:id).
  // Restent dans server/routes.ts (gelé) : /api/invoices/* et /api/suppliers/:id/invoices/payment.
  // Les nouvelles fonctions de facturation passent par /api/billing/*.

  // Route de santé pour l'API
  // Réponse publique minimale (statut + version) : c'est ce que lisent les sondes
  // (deploy/docker-compose.yml ne regarde que le code HTTP). Aucune lecture de données métier.
  // Version : APP_VERSION si définie, sinon npm_package_version (absente quand l'image lance `node dist`),
  // sinon "unknown". Repli connu : en déploiement, définir APP_VERSION dans l'environnement du service.
  apiRouter.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "unknown",
    });
  });

  // Détail du descriptif de l'API : réservé aux administrateurs (chemin dédié, la sonde reste simple).
  apiRouter.get("/health/details", isAdmin, (_req, res) => {
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
import { authenticate, authorize, isAdmin, sessionGuard, isStaff, isTechnician, isWorkshopManager } from "../middleware/auth";
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
  SUPPLIER_INVOICE_READ_ROLES,
  SUPPLIER_READ_ROLES,
} from "@shared/constants/roles";
export default createApiRouter(sessionMiddleware);
