import { Router } from "express";
import { fuelAnomalyParamsSchema, updateFuelAnomalyRequestSchema } from "@shared/contracts/fuel-anomalies";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { isFuelCardManager } from "../middleware/auth";
import { fuelAnomalyResolutionService } from "../services/fuel-anomaly-resolution-service";

const log = moduleLogger("fuel-anomalies");
const router = Router();

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
