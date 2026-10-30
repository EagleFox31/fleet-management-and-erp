import { Router } from "express";
import { authenticate, isAnyUser } from "../middleware/auth";
import { vehicleDocumentationService } from "../services/vehicle-documentation-service";
import { db } from "../db";
import { vehicleDocuments, vehicles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { AppError } from "../lib/app-error";
import { canAccessOwned, ownerScopeOf, OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { moduleLogger } from "../lib/logger";

const router = Router();
const log = moduleLogger("vehicles-routes");

const broadcastVehicleUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    vehicleId?: number | null;
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
    entity: "vehicle",
    entityId: options?.vehicleId ?? null,
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
 * Routes API Véhicules & Documentation
 * Exploitation des 27 véhicules et 22 avec documentation
 */

// Apply authentication middleware to ALL routes in this router
router.use(authenticate);

/**
 * GET /api/vehicles/expiring-docs?days=30
 * Récupère les documents expirant bientôt
 */
router.get("/expiring-docs", isAnyUser, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const docs = await vehicleDocumentationService.getExpiringDocuments(days, ownerScopeOf(req.user));
    return res.status(200).json(docs);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "lecture des documents expirant bientôt en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/vehicles/expired-docs
 * Récupère les documents déjà expirés
 */
router.get("/expired-docs", isAnyUser, async (req, res, next) => {
  try {
    const docs = await vehicleDocumentationService.getExpiredDocuments(ownerScopeOf(req.user));
    return res.status(200).json(docs);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "lecture des documents expirés en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/vehicles/documents/all
 * Tous les documents de tous les véhicules avec statut calculé
 */
router.get("/documents/all", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    const rows = await db
      .select({
        id: vehicleDocuments.id,
        vehicleId: vehicleDocuments.vehicleId,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        name: vehicleDocuments.name,
        type: vehicleDocuments.type,
        description: vehicleDocuments.description,
        filename: vehicleDocuments.filename,
        filesize: vehicleDocuments.filesize,
        filePath: vehicleDocuments.filePath,
        expiryDate: vehicleDocuments.expiryDate,
        createdAt: vehicleDocuments.createdAt,
        updatedAt: vehicleDocuments.updatedAt,
      })
      .from(vehicleDocuments)
      .leftJoin(vehicles, eq(vehicleDocuments.vehicleId, vehicles.id))
      .where(ownerId === null ? undefined : eq(vehicles.ownerId, ownerId))
      .orderBy(vehicleDocuments.expiryDate);

    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(now.getDate() + 30);

    const docs = rows.map((doc) => {
      let expiryStatus: "valid" | "expiring" | "expired" | "none" = "none";
      if (doc.expiryDate) {
        const expiry = new Date(doc.expiryDate);
        if (expiry < now) expiryStatus = "expired";
        else if (expiry <= in30Days) expiryStatus = "expiring";
        else expiryStatus = "valid";
      }
      return { ...doc, expiryStatus };
    });

    return res.status(200).json(docs);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "lecture de tous les documents en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * PUT /api/vehicles/:id/mileage
 * Mise à jour kilométrage véhicule
 */
router.put("/:id/mileage", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { kilometers } = req.body;
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    if (!kilometers || isNaN(kilometers) || kilometers < 0) {
      return res.status(400).json({ message: "Kilométrage invalide" });
    }

    if (!(await canAccessOwned(req.user, () => vehicleDocumentationService.getVehicleOwnerId(vehicleId)))) {
      return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
    }
    
    const vehicle = await vehicleDocumentationService.updateMileage(
      vehicleId,
      parseInt(kilometers)
    );

    broadcastVehicleUpdate(
      "vehicle_mileage_updated",
      {
        vehicleId,
        kilometers: parseInt(kilometers),
        vehicle,
      },
      {
        vehicleId,
        actorUserId: req.session?.userId ?? null,
        actorRole: req.session?.role ?? null,
      },
    );
    
    return res.status(200).json(vehicle);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "mise à jour du kilométrage en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * PUT /api/vehicles/:id/maintenance-position
 * Mise à jour position maintenance véhicule
 */
router.put("/:id/maintenance-position", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { position } = req.body;
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    if (!position || typeof position !== 'string') {
      return res.status(400).json({ message: "Position invalide" });
    }

    if (!(await canAccessOwned(req.user, () => vehicleDocumentationService.getVehicleOwnerId(vehicleId)))) {
      return res.status(403).json({ message: OUT_OF_SCOPE_MESSAGE });
    }
    
    const vehicle = await vehicleDocumentationService.updateMaintenancePosition(
      vehicleId,
      position
    );

    broadcastVehicleUpdate(
      "vehicle_maintenance_position_updated",
      {
        vehicleId,
        position,
        vehicle,
      },
      {
        vehicleId,
        actorUserId: req.session?.userId ?? null,
        actorRole: req.session?.role ?? null,
      },
    );
    
    return res.status(200).json(vehicle);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "mise à jour de la position maintenance en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/vehicles/document-stats
 * Statistiques documents par type
 */
router.get("/document-stats", isAnyUser, async (req, res, next) => {
  try {
    const stats = await vehicleDocumentationService.getDocumentStats(ownerScopeOf(req.user));
    return res.status(200).json(stats);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "statistiques documents en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * GET /api/vehicles/all-with-status
 * Récupère tous les véhicules avec statut documents
 */
router.get("/all-with-status", isAnyUser, async (req, res, next) => {
  try {
    const vehicles = await vehicleDocumentationService.getAllVehiclesWithDocStatus(ownerScopeOf(req.user));
    return res.status(200).json(vehicles);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "lecture des véhicules avec statut documents en échec");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
