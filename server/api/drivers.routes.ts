import { Router } from "express";
import { authenticate, isDriverManager } from "../middleware/auth";
import { cpcTrainingService } from "../services/cpc-training-service";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { moduleLogger } from "../lib/logger";
import { DRIVER_CPC_FORBIDDEN_MESSAGE, redactDriverPersonalData } from "../lib/driver-scope";
import { withLogContext } from "../lib/error-log-context";
import { CPC_TRAINING_DATE_FUTURE_MESSAGE, isCpcTrainingDateInFuture } from "../lib/driver-cpc-input";

const log = moduleLogger("drivers");

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
    const drivers = await cpcTrainingService.getAllDriversStatus();
    return res.status(200).json(await redactDriverPersonalData(req.user, drivers));
  } catch (error) {
    return next(withLogContext(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }), { event: "Liste des chauffeurs en echec" }));
  }
});

/**
 * GET /api/drivers/cpc-status
 * Récupère tous les chauffeurs avec statut CPC (alias de GET /api/drivers)
 */
router.get("/cpc-status", async (req, res, next) => {
  try {
    const statuses = await cpcTrainingService.getAllDriversStatus();
    return res.status(200).json(await redactDriverPersonalData(req.user, statuses));
  } catch (error) {
    return next(withLogContext(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }), { event: "Statut CPC des chauffeurs en echec" }));
  }
});

/**
 * GET /api/drivers/expiring-cpc
 * Récupère les chauffeurs nécessitant formation CPC
 */
router.get("/expiring-cpc", async (req, res, next) => {
  try {
    const alerts = await cpcTrainingService.getExpiringCPCAlerts();
    return res.status(200).json(await redactDriverPersonalData(req.user, alerts));
  } catch (error) {
    return next(withLogContext(new AppError(500, "Impossible de charger les chauffeurs.", { cause: error }), { event: "Alertes CPC en echec" }));
  }
});

/**
 * POST /api/drivers/:id/update-cpc
 * Mise à jour certification CPC chauffeur
 */
router.post("/:id/update-cpc", (req, res, next) => {
  // Un chauffeur ne certifie pas sa propre formation : message dédié avant la garde générale.
  if (req.user?.role === "driver") {
    return next(new AppError(403, DRIVER_CPC_FORBIDDEN_MESSAGE));
  }
  next();
}, isDriverManager, async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");
    const { cpcDate } = req.body;

    if (!cpcDate) {
      return res.status(400).json({ message: "Date CPC requise" });
    }

    const parsedCpcDate = new Date(cpcDate);
    if (Number.isNaN(parsedCpcDate.getTime())) {
      return next(new AppError(400, "Date CPC invalide."));
    }
    if (isCpcTrainingDateInFuture(parsedCpcDate)) {
      return next(new AppError(400, CPC_TRAINING_DATE_FUTURE_MESSAGE));
    }

    const driver = await cpcTrainingService.updateCPCCertification(
      driverId,
      parsedCpcDate
    );

    broadcastDriverCpcUpdate(
      "driver_cpc_updated",
      {
        driverId,
        cpcDate,
      },
      {
        driverId,
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );
    
    return res.status(200).json(await redactDriverPersonalData(req.user, driver));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Impossible de mettre à jour la certification CPC.", { cause: error }), { event: "Mise a jour CPC en echec" }));
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
    return next(withLogContext(new AppError(500, "Impossible de charger les statistiques CPC.", { cause: error }), { event: "Statistiques CPC en echec" }));
  }
});

/**
 * GET /api/drivers/:id/cpc-status
 * Récupère statut CPC d'un chauffeur spécifique
 */
router.get("/:id/cpc-status", async (req, res, next) => {
  try {
    const driverId = parseRouteId(req.params.id, "ID de chauffeur invalide");
    
    const driver = await cpcTrainingService.getDriverWithCPCStatus(driverId);
    return res.status(200).json(await redactDriverPersonalData(req.user, driver));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Impossible de charger le chauffeur.", { cause: error }), { event: "Statut CPC du chauffeur en echec" }));
  }
});

/**
 * POST /api/drivers/sync-cpc-statuses
 * Synchronise tous les statuts CPC (maintenance)
 */
router.post("/sync-cpc-statuses", isDriverManager, async (req, res, next) => {
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
    return next(withLogContext(new AppError(500, "Impossible de synchroniser les statuts CPC.", { cause: error }), { event: "Synchronisation des statuts CPC en echec" }));
  }
});

export default router;
