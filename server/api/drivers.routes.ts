import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { cpcTrainingService } from "../services/cpc-training-service";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("drivers-routes");

/**
 * Cloison chauffeur (R-13) : un chauffeur ne voit que sa propre fiche (drivers.userId).
 * Le reste du personnel garde la liste complete.
 */
function scopeToDriver<T extends { userId: number | null }>(rows: T[], user: { id: number; role: string } | undefined): T[] {
  return user?.role === "driver" ? rows.filter((row) => row.userId === user.id) : rows;
}

const router = Router();

const broadcastDriverCpcUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    driverId?: number | null;
    actorUserId?: number | null;
    actorRole?: string | null;
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    version: 1,
    entity: "driver",
    entityId: options?.driverId ?? null,
    payload,
    scope: { type: "broadcast" },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

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
    return res.status(200).json(scopeToDriver(rows, req.user));
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
    return res.status(200).json(scopeToDriver(rows, req.user));
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
    return res.status(200).json(scopeToDriver(rows, req.user));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Alertes CPC en echec");
    next(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }));
  }
});

/**
 * POST /api/drivers/:id/update-cpc
 * Mise à jour certification CPC chauffeur
 */
router.post("/:id/update-cpc", async (req, res) => {
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

    broadcastDriverCpcUpdate(
      "driver_cpc_updated",
      {
        driverId,
        cpcDate,
        driver,
      },
      {
        driverId,
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );
    
    return res.status(200).json(driver);
  } catch (error) {
    console.error("Update CPC error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/drivers/cpc-statistics
 * Statistiques formations CPC
 */
router.get("/cpc-statistics", async (req, res) => {
  try {
    const stats = await cpcTrainingService.getCPCStatistics();
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Get CPC statistics error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/drivers/:id/cpc-status
 * Récupère statut CPC d'un chauffeur spécifique
 */
router.get("/:id/cpc-status", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    
    if (isNaN(driverId)) {
      return res.status(400).json({ message: "ID de chauffeur invalide" });
    }
    
    const driver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    return res.status(200).json(driver);
  } catch (error) {
    console.error("Get driver CPC status error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * POST /api/drivers/sync-cpc-statuses
 * Synchronise tous les statuts CPC (maintenance)
 */
router.post("/sync-cpc-statuses", async (req, res) => {
  try {
    const result = await cpcTrainingService.syncAllCPCStatuses();

    broadcastDriverCpcUpdate(
      "driver_cpc_statuses_synced",
      {
        result,
      },
      {
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("Sync CPC statuses error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

export default router;
