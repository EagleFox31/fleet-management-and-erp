import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { vehicleDocumentationService } from "../services/vehicle-documentation-service";
import { db } from "../db";
import { vehicleDocuments, vehicles } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

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
router.get("/expiring-docs", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const docs = await vehicleDocumentationService.getExpiringDocuments(days);
    return res.status(200).json(docs);
  } catch (error) {
    console.error("Get expiring documents error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/vehicles/expired-docs
 * Récupère les documents déjà expirés
 */
router.get("/expired-docs", async (req, res) => {
  try {
    const docs = await vehicleDocumentationService.getExpiredDocuments();
    return res.status(200).json(docs);
  } catch (error) {
    console.error("Get expired documents error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/vehicles/documents/all
 * Tous les documents de tous les véhicules avec statut calculé
 */
router.get("/documents/all", async (req, res) => {
  try {
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
    console.error("Get all documents error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * PUT /api/vehicles/:id/mileage
 * Mise à jour kilométrage véhicule
 */
router.put("/:id/mileage", async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { kilometers } = req.body;
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    if (!kilometers || isNaN(kilometers) || kilometers < 0) {
      return res.status(400).json({ message: "Kilométrage invalide" });
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
    console.error("Update mileage error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * PUT /api/vehicles/:id/maintenance-position
 * Mise à jour position maintenance véhicule
 */
router.put("/:id/maintenance-position", async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { position } = req.body;
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    if (!position || typeof position !== 'string') {
      return res.status(400).json({ message: "Position invalide" });
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
    console.error("Update maintenance position error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/vehicles/document-stats
 * Statistiques documents par type
 */
router.get("/document-stats", async (req, res) => {
  try {
    const stats = await vehicleDocumentationService.getDocumentStats();
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Get document stats error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

/**
 * GET /api/vehicles/all-with-status
 * Récupère tous les véhicules avec statut documents
 */
router.get("/all-with-status", async (req, res) => {
  try {
    const vehicles = await vehicleDocumentationService.getAllVehiclesWithDocStatus();
    return res.status(200).json(vehicles);
  } catch (error) {
    console.error("Get vehicles with status error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

export default router;
