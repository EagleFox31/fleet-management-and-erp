import { Router } from "express";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { parseRouteId } from "../lib/route-id";
import { assertVehicleSubresourcesReadable } from "../lib/vehicle-subresource-guard";
import { isAnyUser } from "../middleware/auth";
import { preventiveMaintenanceService } from "../services/preventive-maintenance-service";
import { storage } from "../storage";

/**
 * Historique d'un véhicule (ordres de travail, plans de maintenance), sorti de `server/routes.ts`
 * (gelé) : même cloison que les autres lectures rattachées au véhicule. Un client ne lit que son
 * véhicule, et plus par ces listes une fois le véhicule retiré ; le personnel lit tout, retiré compris.
 * Le détail d'un OT (`GET /api/work-orders/:id`, `assertWorkOrderReadable`) reste lisible : l'historique
 * d'un OT n'est pas rattaché au retrait du véhicule.
 */
const router = Router();

const INVALID_ID = "ID de véhicule invalide";

const failure = (event: string, err: unknown) =>
  err instanceof AppError ? err : withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event });

router.get("/work-orders/vehicle/:vehicleId", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, vehicleId);
    return res.status(200).json(await storage.getWorkOrdersByVehicleId(vehicleId));
  } catch (err) {
    return next(failure("lecture des OT du véhicule en échec", err));
  }
});

router.get("/maintenance-schedules/vehicle/:vehicleId", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, vehicleId);
    return res.status(200).json(await preventiveMaintenanceService.getVehicleMaintenanceSchedules(vehicleId));
  } catch (err) {
    return next(failure("lecture des plans de maintenance du véhicule en échec", err));
  }
});

export default router;
