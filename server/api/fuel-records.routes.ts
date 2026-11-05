import { Router } from "express";
import { AppError } from "../lib/app-error";
import { withLogContext } from "../lib/error-log-context";
import { broadcastFuelRecordChanged } from "../lib/fuel-record-realtime";
import { moduleLogger } from "../lib/logger";
import { idParam } from "../lib/route-helpers";
import { parseRouteId } from "../lib/route-id";
import { assertVehicleSubresourcesReadable } from "../lib/vehicle-subresource-guard";
import { FUEL_CARD_MANAGER_ROLES } from "@shared/constants/roles";
import type { FuelRecord } from "@shared/schema";
import { authorize, isAnyUser } from "../middleware/auth";
import { FuelService } from "../services/fuel-service";

const log = moduleLogger("fuel-records");
const router = Router();
const fuelService = new FuelService();

/**
 * Pleins d'un véhicule, sortis de server/routes.ts (gelé) : même cloison que les autres lectures
 * rattachées au véhicule. Par ce chemin, un client ne lit que les pleins de son véhicule, et plus
 * une fois le véhicule retiré ; le personnel lit tout, véhicule retiré compris. Limite : les filtres
 * `?vehicleId=` de `/fuel-records` et `/fuel-records/consumption-history` ne sont pas encore cloisonnés (L1b).
 */
router.get("/fuel-records/vehicle/:vehicleId", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, "ID de véhicule invalide");
    await assertVehicleSubresourcesReadable(req, vehicleId);
    const records = await fuelService.getFuelRecordsByVehicleId(vehicleId);
    return res.status(200).json(
      records.map((record: FuelRecord) => ({
        ...record,
        pricePerLiter: record.quantity > 0 ? Number(record.cost) / record.quantity : 0,
        totalCost: Number(record.cost),
      })),
    );
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "lecture des pleins du véhicule en échec" }));
  }
});

/**
 * Suppression d'un plein, sortie de server/routes.ts (gelé). Montée avant registerRoutes :
 * Express sert la première déclaration. La suppression passe par le service, qui prend le
 * verrou de la carte carburant (le solde est une somme sur fuel_records).
 *
 * Deux familles de rôles : le chef d'atelier supprime un plein physique (garde historique), les
 * gestionnaires de la carte supprimaient en plus un plein qui a mouvementé la carte (suppression
 * douce, tracée). Le service tranche sous verrou, après relecture de la ligne : 403 au chef d'atelier
 * sur un plein qui a mouvementé la carte, 404 sur une ligne absente ou déjà supprimée.
 */
router.delete("/fuel-records/:id", authorize([...FUEL_CARD_MANAGER_ROLES, "workshop_manager"]), async (req, res, next) => {
  try {
    const id = idParam(req.params.id, "Identifiant d'enregistrement de carburant");
    const user = req.user!; // authorize() a déjà refusé toute requête sans utilisateur
    const deleted = await fuelService.deleteFuelRecord(id, { id: user.id, role: user.role });
    if (!deleted) throw new AppError(404, "Enregistrement de carburant non trouvé");
    log.info({ requestId: req.requestId, fuelRecordId: id, userId: user.id }, "Plein carburant supprimé");
    broadcastFuelRecordChanged(id, req.requestId);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Delete fuel record error" }));
  }
});

export default router;
