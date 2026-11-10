import { Router } from "express";
import { z } from "zod";
import { routeIdSchema } from "@shared/contracts/common";
import { AppError } from "../lib/app-error";
import { lastVehiclePositions } from "../services/vehicle-positions-service";

/**
 * Dernière position connue des véhicules (GPS V1). Monté sur `/api/vehicle-positions` avec le
 * drapeau `gps` et `GPS_VIEW_ROLES` (admin, logistics, management, workshop_manager). Les points
 * suspects n'y figurent pas. Le client n'y a pas accès (portail client plus tard).
 */
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const q = z.object({ maxAgeMinutes: z.coerce.number().int().min(1).max(10080).optional() }).parse(req.query);
    res.json(await lastVehiclePositions({ maxAgeMinutes: q.maxAgeMinutes }));
  } catch (error) {
    next(error);
  }
});

router.get("/:vehicleId", async (req, res, next) => {
  try {
    const vehicleId = routeIdSchema.parse(req.params.vehicleId);
    const [row] = await lastVehiclePositions({ vehicleId });
    if (!row) throw new AppError(404, "Aucune position connue pour ce véhicule.");
    res.json(row);
  } catch (error) {
    next(error);
  }
});

export default router;
