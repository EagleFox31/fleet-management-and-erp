import { Router } from "express";
import { isAnyUser } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { ownerScopeOf } from "../lib/client-scope";
import { findOwnedVehicleByRegistration, listVehiclesForOwner } from "../services/vehicle-scope-service";

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

router.get("/vehicles", isAnyUser, async (req, res, next) => {
  try {
    const ownerId = ownerScopeOf(req.user);
    if (ownerId === null) return next();
    const q = req.query;
    const result = await listVehiclesForOwner(ownerId, {
      search: typeof q.search === "string" ? q.search : undefined,
      status: typeof q.status === "string" && q.status ? q.status : undefined,
      vehicleType: typeof q.vehicle_type === "string" && q.vehicle_type ? q.vehicle_type : undefined,
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

export default router;
