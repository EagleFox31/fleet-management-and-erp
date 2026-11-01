import { Router } from "express";
import { authenticate, isDriverManager } from "../middleware/auth";
import { cpcTrainingService } from "../services/cpc-training-service";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { assertOwnDriverRecord, redactDriverList, redactDriverPersonalData } from "../lib/driver-scope";
import { broadcastDriverEvent } from "../lib/driver-realtime";

const log = moduleLogger("drivers-routes");

/**
 * Cloison chauffeur (R-13) : un chauffeur ne voit que sa propre fiche (drivers.userId).
 * Le reste du personnel garde la liste complete.
 */
function scopeToDriver<T extends { userId: number | null }>(rows: T[], user: { id: number; role: string } | undefined): T[] {
  return user?.role === "driver" ? rows.filter((row) => row.userId === user.id) : rows;
}

const router = Router();

/**
 * Routes API Drivers & CPC Formations
 * Exploitation des 27 chauffeurs avec formations CPC
 */

// Apply authentication middleware to ALL routes in this router
router.use(authenticate);

/**
 * GET /api/drivers
 * Récupère tous les chauffeurs avec statut CPC
 * Route principale pour l'affichage des chauffeurs
 */
router.get("/", async (req, res, next) => {
  try {
    const rows = await cpcTrainingService.getAllDriversStatus();
    return res.status(200).json(redactDriverList(scopeToDriver(rows, req.user), req.user));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Liste des chauffeurs en echec");
    next(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }));
  }
});

/**
 * GET /api/drivers/cpc-status
 * Récupère tous les chauffeurs avec statut CPC (alias de GET /api/drivers)
 */
router.get("/cpc-status", async (req, res, next) => {
  try {
    const rows = await cpcTrainingService.getAllDriversStatus();
    return res.status(200).json(redactDriverList(scopeToDriver(rows, req.user), req.user));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Statut CPC des chauffeurs en echec");
    next(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }));
  }
});

/**
 * GET /api/drivers/expiring-cpc
 * Récupère les chauffeurs nécessitant formation CPC
 */
router.get("/expiring-cpc", async (req, res, next) => {
  try {
    const rows = await cpcTrainingService.getExpiringCPCAlerts();
    return res.status(200).json(redactDriverList(scopeToDriver(rows, req.user), req.user));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Alertes CPC en echec");
    next(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }));
  }
});

/**
 * POST /api/drivers/:id/update-cpc
 * Mise à jour certification CPC chauffeur
 */
router.post("/:id/update-cpc", isDriverManager, async (req, res, next) => {
  try {
    const driverId = parseInt(req.params.id);
    const { cpcDate } = req.body;
    
    if (isNaN(driverId)) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }
    
    if (!cpcDate) {
      return res.status(400).json({ message: "Date CPC requise" });
    }
    
    const driver = await cpcTrainingService.updateCPCCertification(
      driverId,
      new Date(cpcDate)
    );

    broadcastDriverEvent(
      "driver_cpc_updated",
      driverId,
      { cpcDate },
      { userId: (req as any).session?.userId ?? null, role: (req as any).session?.role ?? null },
    );
    
    return res.status(200).json(driver);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Update CPC error");
    return next(new AppError(500, "Mise a jour de la certification CPC impossible.", { cause: error }));
  }
});

/**
 * GET /api/drivers/cpc-statistics
 * Statistiques formations CPC
 */
router.get("/cpc-statistics", async (req, res, next) => {
  try {
    const stats = await cpcTrainingService.getCPCStatistics();
    return res.status(200).json(stats);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get CPC statistics error");
    return next(new AppError(500, "Impossible de charger les statistiques CPC.", { cause: error }));
  }
});

/**
 * GET /api/drivers/:id/cpc-status
 * Récupère statut CPC d'un chauffeur spécifique
 */
router.get("/:id/cpc-status", async (req, res, next) => {
  try {
    await assertOwnDriverRecord(req.user, Number.parseInt(req.params.id, 10));
  } catch (error) {
    return next(error);
  }
  try {
    const driverId = parseInt(req.params.id);
    
    if (isNaN(driverId)) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }
    
    const driver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    return res.status(200).json(driver ? redactDriverPersonalData(driver, req.user) : driver);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get driver CPC status error");
    return next(new AppError(500, "Impossible de charger le statut CPC.", { cause: error }));
  }
});

/**
 * POST /api/drivers/sync-cpc-statuses
 * Synchronise tous les statuts CPC (maintenance)
 */
router.post("/sync-cpc-statuses", isDriverManager, async (req, res, next) => {
  try {
    const result = await cpcTrainingService.syncAllCPCStatuses();

    broadcastDriverEvent(
      "driver_cpc_statuses_synced",
      null,
      { result },
      { userId: (req as any).session?.userId ?? null, role: (req as any).session?.role ?? null },
    );

    return res.status(200).json(result);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Sync CPC statuses error");
    return next(new AppError(500, "Synchronisation des statuts CPC impossible.", { cause: error }));
  }
});

export default router;
