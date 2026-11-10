import { Router } from "express";
import { isVehicleOperationWriter, authenticate, isAdmin, isAnyUser, isStaff } from "../middleware/auth";
import { vehicleDocumentationService } from "../services/vehicle-documentation-service";
import { db } from "../db";
import { vehicleDocuments, vehicles } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { ownerScopeOf } from "../lib/client-scope";
import { clientVehicleScope } from "../lib/client-vehicle-scope";
import { canWriteVehicleMileage, OUT_OF_ASSIGNED_VEHICLE_MILEAGE_MESSAGE } from "../lib/driver-scope";
import { boundedInt, listVehicles, VEHICLE_LIST_DEFAULT_LIMIT, VEHICLE_LIST_MAX_LIMIT } from "../services/vehicle-list-service";
import { moduleLogger } from "../lib/logger";
import { withLogContext } from "../lib/error-log-context";
import { canReadVehiclePurchasePrice, VEHICLE_DOCUMENT_EVENT_ROLES } from "@shared/constants/roles";
import { redactVehiclePriceDeep } from "../lib/vehicle-price-scope";
import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";

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

  // Cloison (AGENTS.md §11) : la trame complète porte la fiche véhicule (prix d'achat compris).
  // Le personnel hors chauffeur la reçoit ; le chauffeur et le seul client propriétaire
  // (`vehicles.ownerId`) reçoivent une trame réduite, sans la fiche : leur écran se resynchronise
  // par la requête. Jamais en broadcast.
  const { vehicle, ...reducedPayload } = payload;
  const ownerId = (vehicle as { ownerId?: unknown } | undefined)?.ownerId;
  const envelope = {
    version: 1,
    entity: "vehicle",
    entityId: options?.vehicleId ?? null,
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  };
  // Prix d'achat : la fiche complète ne part qu'aux rôles autorisés (décision du 3 novembre 2026).
  const priceRoles = VEHICLE_DOCUMENT_EVENT_ROLES.filter((role) => canReadVehiclePurchasePrice(role));
  const otherStaffRoles = VEHICLE_DOCUMENT_EVENT_ROLES.filter((role) => !canReadVehiclePurchasePrice(role));
  broadcastUpdate(eventType, { ...envelope, payload, scope: { type: "roles", roles: [...priceRoles] } });
  broadcastUpdate(eventType, { ...envelope, payload: redactVehiclePriceDeep(null, payload), scope: { type: "roles", roles: [...otherStaffRoles] } });
  broadcastUpdate(eventType, { ...envelope, payload: reducedPayload, scope: { type: "roles", roles: ["driver"] } });
  if (typeof ownerId === "number" && Number.isInteger(ownerId) && ownerId > 0) {
    broadcastUpdate(eventType, { ...envelope, actor: null, payload: reducedPayload, scope: { type: "user", userIds: [ownerId] } });
  }
};

/**
 * Routes API Véhicules & Documentation
 * Exploitation des 27 véhicules et 22 avec documentation
 */

// Apply authentication middleware to ALL routes in this router
router.use(authenticate);

/**
 * GET /api/vehicles : liste paginée. Un client ne reçoit que ses véhicules
 * (AGENTS.md §11) ; le personnel les voit tous. Déclarée avant routes.ts (gelé).
 */
router.get("/", isAnyUser, async (req, res, next) => {
  try {
    const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
    const result = await listVehicles({
      search: str(req.query.search),
      status: str(req.query.status),
      vehicleType: str(req.query.vehicle_type),
      limit: boundedInt(req.query.limit, VEHICLE_LIST_DEFAULT_LIMIT, 1, VEHICLE_LIST_MAX_LIMIT),
      offset: boundedInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      sortBy: str(req.query.sort_by),
      sortOrder: req.query.sort_order === "asc" ? "asc" : "desc",
      ownerId: ownerScopeOf(req.user),
    });
    return res.status(200).json(redactVehiclePriceDeep(req.user, result));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture de la liste des véhicules en échec" }));
  }
});

/** GET /api/vehicles/all : tous les véhicules (export), cloisonnés comme la liste. */
router.get("/all", isAnyUser, async (req, res, next) => {
  try {
    const result = await listVehicles({ limit: VEHICLE_LIST_MAX_LIMIT, ownerId: ownerScopeOf(req.user) });
    return res.status(200).json(redactVehiclePriceDeep(req.user, result.vehicles));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture de tous les véhicules en échec" }));
  }
});

/**
 * GET /api/vehicles/expiring-docs?days=30
 * Récupère les documents expirant bientôt
 */
router.get("/expiring-docs", isAnyUser, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const docs = await vehicleDocumentationService.getExpiringDocuments(days, ownerScopeOf(req.user));
    return res.status(200).json(redactVehiclePriceDeep(req.user, docs));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture des documents expirant bientôt en échec" }));
  }
});

/**
 * GET /api/vehicles/expired-docs
 * Récupère les documents déjà expirés
 */
router.get("/expired-docs", isAnyUser, async (req, res, next) => {
  try {
    const docs = await vehicleDocumentationService.getExpiredDocuments(ownerScopeOf(req.user));
    return res.status(200).json(redactVehiclePriceDeep(req.user, docs));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture des documents expirés en échec" }));
  }
});

/**
 * GET /api/vehicles/check-alerts
 * Alertes d'entretien et d'expiration de documents, limitées au périmètre du client.
 * Déclarée avant `/:id` : la version de routes.ts était masquée par `/api/vehicles/:id`.
 */
router.get("/check-alerts", isAnyUser, async (req, res, next) => {
  try {
    const ownerScope = ownerScopeOf(req.user);
    const fleet = await db
      .select()
      .from(vehicles)
      .where(ownerScope === null ? isNull(vehicles.deletedAt) : and(isNull(vehicles.deletedAt), eq(vehicles.ownerId, ownerScope)));
    const documents = fleet.length === 0
      ? []
      : await db.select().from(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, fleet.map((v) => v.id)));
    const alerts: Array<Record<string, unknown>> = [];
    const now = new Date();
    const daysUntil = (date: string | Date) => Math.ceil((new Date(date).getTime() - now.getTime()) / 86_400_000);
    const documentLabels: Record<string, string> = {
      carte_grise: "Carte grise",
      assurance: "Assurance",
      visite_technique: "Visite technique",
      taxe: "Taxe",
    };

    for (const vehicle of fleet) {
      const plate = vehicle.registrationNumber;
      if (vehicle.nextMaintenanceDate) {
        const days = daysUntil(vehicle.nextMaintenanceDate);
        if (days <= 0) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, type: "maintenance_overdue", priority: "high",
            message: `L'entretien du véhicule ${plate} est en retard de ${Math.abs(days)} jours.` });
        } else if (days <= 7) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, type: "maintenance_due", priority: "medium",
            message: `L'entretien du véhicule ${plate} doit être effectué dans ${days} jours.` });
        }
      }
      if (vehicle.nextMaintenanceMileage && vehicle.mileage) {
        const remaining = vehicle.nextMaintenanceMileage - vehicle.mileage;
        if (remaining <= 0) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, type: "maintenance_mileage_exceeded", priority: "high",
            message: `Le kilométrage du véhicule ${plate} a dépassé la limite pour l'entretien de ${Math.abs(remaining)} km.` });
        } else if (remaining <= 500) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, type: "maintenance_mileage_approaching", priority: "medium",
            message: `Le kilométrage du véhicule ${plate} approche la limite pour l'entretien (${remaining} km restants).` });
        }
      }
      for (const doc of documents.filter((d) => d.vehicleId === vehicle.id && d.expiryDate)) {
        // Règle partagée (expiry-day.ts) : jour UTC, valable le jour J, expiré à J+1.
        const expiryDateOnly = toExpiryDateOnly(doc.expiryDate);
        if (expiryDateOnly === null) continue;
        const days = daysBetweenDateOnly(expiryDateOnly, todayUtcDateOnly(now));
        const label = documentLabels[doc.type] ?? doc.name;
        if (days < 0) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, documentId: doc.id, type: "document_expired", priority: "critical",
            message: `Le document "${label}" du véhicule ${plate} est expiré depuis ${Math.abs(days)} jours.` });
        } else if (days <= 30) {
          alerts.push({ vehicleId: vehicle.id, registrationNumber: plate, documentId: doc.id, type: "document_expiring",
            priority: days <= 7 ? "high" : "medium",
            message: `Le document "${label}" du véhicule ${plate} expire dans ${days} jours.` });
        }
      }
    }
    return res.status(200).json(alerts);
  } catch (error) {
    return next(withLogContext(new AppError(500, "Impossible de calculer les alertes des véhicules.", { cause: error }), { event: "contrôle des alertes véhicules en échec" }));
  }
});

/**
 * GET /api/vehicles/archived
 * Véhicules archivés (administrateur). Même raison de placement que `check-alerts`.
 */
router.get("/archived", isAdmin, async (req, res, next) => {
  try {
    // La table `vehicle_archived` n'existe dans aucune migration : un véhicule retiré de la
    // flotte est un véhicule dont `deleted_at` est renseigné (suppression douce).
    const rows = await db
      .select({
        id: vehicles.id,
        registration_number: vehicles.registrationNumber,
        brand: vehicles.brand,
        model: vehicles.model,
        status: vehicles.status,
        archived_at: vehicles.deletedAt,
      })
      .from(vehicles)
      .where(isNotNull(vehicles.deletedAt))
      .orderBy(desc(vehicles.deletedAt));
    return res.status(200).json(rows);
  } catch (error) {
    return next(withLogContext(new AppError(500, "Impossible de lire les véhicules archivés.", { cause: error }), { event: "lecture des véhicules archivés en échec" }));
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
      .where(clientVehicleScope(req.user))
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
      // Le chemin disque ne sert qu'au serveur : un client télécharge par `/api/documents/:id/download`.
      if (ownerId !== null) {
        const { filePath: _filePath, ...visible } = doc;
        return { ...visible, expiryStatus };
      }
      return { ...doc, expiryStatus };
    });

    return res.status(200).json(docs);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture de tous les documents en échec" }));
  }
});

/**
 * PUT /api/vehicles/:id/mileage
 * Mise à jour kilométrage véhicule
 */
router.put("/:id/mileage", isVehicleOperationWriter, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.id, "ID de véhicule invalide");
    const { kilometers } = req.body;

    // Un chauffeur ne saisit que le véhicule de son affectation active (option A : avant clôture).
    if (!(await canWriteVehicleMileage(req.user, vehicleId))) {
      throw new AppError(403, OUT_OF_ASSIGNED_VEHICLE_MILEAGE_MESSAGE);
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
    
    return res.status(200).json(redactVehiclePriceDeep(req.user, vehicle));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "mise à jour du kilométrage en échec" }));
  }
});

/**
 * PUT /api/vehicles/:id/maintenance-position
 * Mise à jour position maintenance véhicule
 */
router.put("/:id/maintenance-position", isVehicleOperationWriter, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.id, "ID de véhicule invalide");
    const { position } = req.body;
    
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
    
    return res.status(200).json(redactVehiclePriceDeep(req.user, vehicle));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "mise à jour de la position maintenance en échec" }));
  }
});

/**
 * GET /api/vehicles/document-stats
 * Statistiques documents par type
 */
router.get("/document-stats", isAnyUser, async (req, res, next) => {
  try {
    const stats = await vehicleDocumentationService.getDocumentStats(ownerScopeOf(req.user));
    return res.status(200).json(redactVehiclePriceDeep(req.user, stats));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "statistiques documents en échec" }));
  }
});

/**
 * GET /api/vehicles/all-with-status
 * Récupère tous les véhicules avec statut documents
 */
router.get("/all-with-status", isAnyUser, async (req, res, next) => {
  try {
    const vehicles = await vehicleDocumentationService.getAllVehiclesWithDocStatus(ownerScopeOf(req.user));
    return res.status(200).json(redactVehiclePriceDeep(req.user, vehicles));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture des véhicules avec statut documents en échec" }));
  }
});

export default router;
