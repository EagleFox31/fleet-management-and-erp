import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { vehicles } from "@shared/schema";
import { db } from "../db";
import { isAnyUser, isStaff } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { OUT_OF_SCOPE_MESSAGE, canAccessOwned, ownerScopeOf } from "../lib/client-scope";
import { tiresService } from "../services/tires-service-simplified";
import { findOwnedVehicleByRegistration, fuelStatisticsForOwner, listVehiclesForOwner } from "../services/vehicle-scope-service";

/**
 * Cloison client sur les lectures de parc (R-03). Monté AVANT `/vehicles` et avant
 * `registerRoutes` (server/app.ts sert `/api` d'abord) : les handlers historiques de
 * server/routes.ts (liste, /all, check) restent servis tels quels au personnel via
 * `next()`, un client est servi ici, filtré sur `vehicles.ownerId`.
 */
const router = Router();

function intParam(raw: unknown, fallback: number): number {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// Valeurs hors enum = 400 avant tout SQL (jamais un filtre silencieux ni une erreur 500).
const listQuerySchema = z.object({
  status: z.enum(vehicles.status.enumValues).optional(),
  vehicle_type: z.enum(vehicles.vehicleType.enumValues).optional(),
});

router.get("/vehicles", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const q = req.query;
    const filters = listQuerySchema.safeParse({
      status: typeof q.status === "string" && q.status ? q.status : undefined,
      vehicle_type: typeof q.vehicle_type === "string" && q.vehicle_type ? q.vehicle_type : undefined,
    });
    if (!filters.success) throw new AppError(400, "Filtre de statut ou de type de vehicule invalide.");
    const result = await listVehiclesForOwner(ownerId, {
      search: typeof q.search === "string" ? q.search : undefined,
      status: filters.data.status,
      vehicleType: filters.data.vehicle_type,
      limit: intParam(q.limit, 10),
      offset: intParam(q.offset, 0),
      sortBy: typeof q.sort_by === "string" ? q.sort_by : undefined,
      sortOrder: q.sort_order === "asc" ? "asc" : "desc",
    });
    return res.status(200).json(result);
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, "Impossible de charger vos véhicules.", { cause: error }));
  }
});

router.get("/vehicles/all", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const result = await listVehiclesForOwner(ownerId, { limit: 1000, offset: 0 });
    return res.status(200).json(result.vehicles);
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, "Impossible de charger vos véhicules.", { cause: error }));
  }
});

// Hors périmètre = même réponse que « inexistant » : l'existence d'un véhicule d'autrui ne fuit pas.
router.get("/vehicles/check/:registrationNumber", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const vehicle = await findOwnedVehicleByRegistration(ownerId, req.params.registrationNumber);
    if (!vehicle) return res.status(200).json({ exists: false });
    return res.status(200).json({ exists: true, id: vehicle.id, registrationNumber: vehicle.registrationNumber });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, "Vérification impossible pour le moment.", { cause: error }));
  }
});

// --- Routes de server/routes.ts ouvertes par `authenticate` seul (R-03) ---------------------
// Meme principe : le personnel passe par `next()` vers le handler historique, un client est
// borne a ses vehicules (`vehicles.ownerId`) ou refuse quand la route n'a pas de sens pour lui.

function vehicleIdOf(raw: unknown): number {
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, "Identifiant de vehicule invalide.");
  return id;
}

async function ownerOfVehicle(vehicleId: number): Promise<number | null | undefined> {
  const [row] = await db.select({ ownerId: vehicles.ownerId }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row?.ownerId;
}

/** Vehicule designe par le parametre `param` : hors perimetre ou inexistant = 403 pour un client. */
function ownVehicleParam(param: string): RequestHandler[] {
  return [
    isAnyUser,
    async (req: Request, _res: Response, next: NextFunction) => {
      try {
        if (ownerScopeOf(req.user) === null) return next();
        const vehicleId = vehicleIdOf(req.params[param]);
        if (!(await canAccessOwned(req.user, () => ownerOfVehicle(vehicleId)))) {
          throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
        }
        next();
      } catch (error) {
        next(error);
      }
    },
  ];
}

router.get("/vehicles/:id/mileage", ...ownVehicleParam("id"));
router.get("/vehicles/:id/mileage/history", ...ownVehicleParam("id"));
router.get("/vehicles/:vehicleId/status-history", ...ownVehicleParam("vehicleId"));
router.get("/vehicles/:vehicleId/tires", ...ownVehicleParam("vehicleId"));
router.get("/work-orders/vehicle/:vehicleId", ...ownVehicleParam("vehicleId"));
router.get("/fuel-records/vehicle/:vehicleId", ...ownVehicleParam("vehicleId"));

// Saisie d'exploitation et vues de parc entier : sans objet pour un client.
router.post("/vehicles/:id/mileage/sync", isStaff);
router.get("/vehicles/check-alerts", isStaff);
router.get("/fuel-records/statistics", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const period = typeof req.query.period === "string" ? req.query.period : "month";
    return res.status(200).json(await fuelStatisticsForOwner(ownerId, period));
  } catch (error) {
    return next(error);
  }
});
router.get("/fuel-records/consumption-history", isStaff);

// Carburant : un vehicule precise est borne au proprietaire, la liste de toute la flotte est refusee.
router.get("/fuel-records", isAnyUser, async (req, _res, next) => {
  try {
    if (ownerScopeOf(req.user) === null) return next();
    if (req.query.vehicleId === undefined || req.query.vehicleId === "") {
      throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
    }
    const vehicleId = vehicleIdOf(req.query.vehicleId);
    if (!(await canAccessOwned(req.user, () => ownerOfVehicle(vehicleId)))) {
      throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Pneus montes : un client recoit ceux de ses vehicules seulement.
router.get("/vehicle-tires", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const owned = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.ownerId, ownerId));
    const ownedIds = new Set(owned.map((row) => row.id));
    const all = await tiresService.getAllVehicleTires();
    return res.status(200).json(all.filter((row) => ownedIds.has(row.vehicleId)));
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(500, "Impossible de charger les pneus.", { cause: error }));
  }
});

export default router;
