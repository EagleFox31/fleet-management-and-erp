import { Router } from "express";
import {
  fuelAnomaliesResponseSchema,
  fuelAnomaliesSummarySchema,
  fuelAnomalyParamsSchema,
  updateFuelAnomalyRequestSchema,
} from "@shared/contracts/fuel-anomalies";
import { FUEL_READ_ROLES } from "@shared/constants/roles";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { authenticate, authorize, isFuelCardManager } from "../middleware/auth";
import { fuelAnomalyResolutionService } from "../services/fuel-anomaly-resolution-service";

const log = moduleLogger("fuel-anomalies");
const router = Router();

/** Liste des anomalies calculées (P-18). Lecture ouverte au chef d'atelier et à la direction, sans action. */
router.get("/fuel-card/anomalies", requireFeature("fuel-anomalies"), authenticate, authorize([...FUEL_READ_ROLES]), async (_req, res, next) => {
  try {
    res.json(fuelAnomaliesResponseSchema.parse(await fuelAnomalyResolutionService.list()));
  } catch (err) {
    next(err);
  }
});

/** Compteur « véhicules sans capacité » : la règle `tank-overflow` y est muette. Mêmes rôles que la liste. */
router.get("/fuel-card/anomalies/summary", requireFeature("fuel-anomalies"), authenticate, authorize([...FUEL_READ_ROLES]), async (_req, res, next) => {
  try {
    const [vehiclesWithoutTankCapacity, vehicles] = await Promise.all([
      fuelAnomalyResolutionService.vehiclesWithoutTankCapacity(),
      fuelAnomalyResolutionService.listVehiclesWithoutTankCapacity(),
    ]);
    res.json(fuelAnomaliesSummarySchema.parse({ vehiclesWithoutTankCapacity, vehicles }));
  } catch (err) {
    next(err);
  }
});

/**
 * Traitement d'une anomalie carburant (P-18). La clé `<règle>:<id de plein>` est dérivée :
 * le PATCH est rejouable, la dernière décision l'emporte.
 */
router.patch("/fuel-card/anomalies/:id", requireFeature("fuel-anomalies"), isFuelCardManager, async (req, res, next) => {
  try {
    const { id } = fuelAnomalyParamsSchema.parse(req.params);
    const body = updateFuelAnomalyRequestSchema.parse(req.body);
    if (!req.user) throw new AppError(401, "Session requise.");
    const resolution = await fuelAnomalyResolutionService.resolve(id, body, req.user.id);

    const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
    if (broadcast) {
      broadcast("fuel_anomaly_resolved", {
        anomalyKey: resolution.anomalyKey,
        fuelRecordId: resolution.fuelRecordId,
        scope: REALTIME_EVENTS.fuel_anomaly_resolved.scope,
      });
    } else {
      log.warn({ requestId: req.requestId }, "diffusion temps réel indisponible");
    }
    res.json(resolution);
  } catch (err) {
    next(err);
  }
});

export default router;
