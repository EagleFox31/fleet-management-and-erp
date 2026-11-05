import { Router } from "express";
import { isAdmin } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { parseRouteId } from "../lib/route-id";
import { broadcastVehicleLifecycle } from "../lib/vehicle-realtime";
import { deleteVehicle, restoreVehicle } from "../services/vehicle-lifecycle-service";

/**
 * Retrait d'un véhicule de la flotte et remise en service. Suppression physique sans aucune
 * action enregistrée, suppression douce sinon (voir `vehicle-lifecycle-service`).
 */
const router = Router();

const INVALID_ID = "ID de véhicule invalide";
const NOT_FOUND = "Véhicule non trouvé";

router.delete("/:id", isAdmin, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, INVALID_ID);
    const outcome = await deleteVehicle(id, req.user?.id ?? null);
    if (!outcome) throw new AppError(404, NOT_FOUND);
    broadcastVehicleLifecycle("vehicle_deleted", id, req.requestId);
    return res.status(200).json({
      message: outcome.mode === "hard"
        ? "Véhicule supprimé."
        : "Véhicule retiré de la flotte. Son historique est conservé.",
      result: outcome,
    });
  } catch (error) {
    return next(error instanceof AppError ? error : new AppError(500, "Erreur lors de la suppression du véhicule", { cause: error }));
  }
});

router.post("/:id/restore", isAdmin, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.id, INVALID_ID);
    const outcome = await restoreVehicle(id, req.user?.id ?? null);
    if (!outcome) throw new AppError(404, NOT_FOUND);
    if (outcome.restored) broadcastVehicleLifecycle("vehicle_restored", id, req.requestId);
    return res.status(200).json({
      message: outcome.restored ? "Véhicule remis dans la flotte." : "Ce véhicule est déjà dans la flotte.",
      result: outcome,
    });
  } catch (error) {
    return next(error instanceof AppError ? error : new AppError(500, "Erreur lors de la restauration du véhicule", { cause: error }));
  }
});

export default router;
