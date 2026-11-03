import { Router } from "express";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { broadcastFuelRecordChanged } from "../lib/fuel-record-realtime";
import { idParam } from "../lib/route-helpers";
import { isWorkshopManager } from "../middleware/auth";
import { FuelService } from "../services/fuel-service";

const router = Router();
const fuelService = new FuelService();

/**
 * Suppression d'un plein, sortie de server/routes.ts (gelé). Montée avant registerRoutes :
 * Express sert la première déclaration. La suppression passe par le service, qui prend le
 * verrou de la carte carburant (le solde est une somme sur fuel_records).
 */
router.delete("/fuel-records/:id", isWorkshopManager, async (req, res, next) => {
  try {
    const id = idParam(req.params.id, "Identifiant d'enregistrement de carburant");
    const deleted = await fuelService.deleteFuelRecord(id);
    if (!deleted) throw new AppError(404, "Enregistrement de carburant non trouvé");
    broadcastFuelRecordChanged(id, req.requestId);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Delete fuel record error" }));
  }
});

export default router;
