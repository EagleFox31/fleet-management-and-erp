import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { db } from "../db";
import { isAnyUser } from "../middleware/auth";
import { AppError } from "../lib/app-error";
import { OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { parseRouteId } from "../lib/route-id";
import { canReadVehicleSubresources } from "../lib/vehicle-retired";
import { redactVehiclePriceDeep } from "../lib/vehicle-price-scope";
import { mileageService } from "../services/mileage-service";
import { tiresService } from "../services/tires-service-simplified";
import { vehicleStatusService } from "../services/vehicle-status-service";
import { storage } from "../storage";

/**
 * Lectures rattachées à un véhicule, extraites de `server/routes.ts` (gelé). Même cloison
 * que le détail : un client ne lit que son véhicule, et plus du tout une fois retiré.
 * Monté avant `registerRoutes`. `/documents/all` est servi plus tôt par `vehicles.routes.ts`.
 * `/check/<immatriculation>` appartient au contrôle d'immatriculation de `routes.ts` : sans le
 * renvoi ci-dessous, `/check/documents` ou `/check/tires` tomberaient ici en 400.
 */
const router = Router();

router.use("/check", (_req, _res, next) => next("router"));

const INVALID_ID = "ID de véhicule invalide";
const MAX_HISTORY_LIMIT = 500;
const DOCUMENT_TYPES = ["carte_grise", "assurance", "visite_technique", "taxe", "autre"];

const vehicleRow = (id: number) => async () =>
  (await db.select({ ownerId: vehicles.ownerId, deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, id)).limit(1))[0];

/** Cloison client (403 hors périmètre ou véhicule retiré). Lève : reconnue comme garde par `route-guard-scan`. */
async function assertVehicleSubresourcesReadable(req: Request, vehicleId: number): Promise<void> {
  if (!(await canReadVehicleSubresources(req.user, vehicleRow(vehicleId)))) throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
}

const failure = (message: string, error: unknown) =>
  error instanceof AppError ? error : new AppError(500, message, { cause: error });

router.get("/:vehicleId/documents", isAnyUser, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.vehicleId, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, id);
    return res.status(200).json(await storage.getVehicleDocuments(id));
  } catch (error) {
    return next(failure("Lecture des documents du véhicule impossible", error));
  }
});

router.get("/:vehicleId/documents/:type", isAnyUser, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.vehicleId, INVALID_ID);
    if (!DOCUMENT_TYPES.includes(req.params.type)) throw new AppError(400, "Type de document invalide");
    await assertVehicleSubresourcesReadable(req, id);
    return res.status(200).json(await storage.getVehicleDocumentsByType(id, req.params.type));
  } catch (error) {
    return next(failure("Lecture des documents du véhicule impossible", error));
  }
});

router.get("/:id/mileage", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.id, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, vehicleId);
    const currentMileage = await mileageService.getCurrentMileage(vehicleId);
    return res.json({ vehicleId, currentMileage, lastMileage: currentMileage });
  } catch (error) {
    return next(failure("Erreur lors de la récupération du kilométrage", error));
  }
});

router.get("/:id/mileage/history", isAnyUser, async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.id, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, vehicleId);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), MAX_HISTORY_LIMIT);
    return res.json(await mileageService.getMileageHistory(vehicleId, limit));
  } catch (error) {
    return next(failure("Erreur lors de la récupération de l'historique", error));
  }
});

router.get("/:vehicleId/status-history", isAnyUser, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.vehicleId, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, id);
    return res.status(200).json(await vehicleStatusService.getVehicleStatusHistory(id));
  } catch (error) {
    return next(failure("Lecture de l'historique de statut impossible", error));
  }
});

router.get("/:vehicleId/tires", isAnyUser, async (req, res, next) => {
  try {
    const id = parseRouteId(req.params.vehicleId, INVALID_ID);
    await assertVehicleSubresourcesReadable(req, id);
    // La jointure renvoie le véhicule entier : le prix d'achat en est retiré pour les rôles non autorisés.
    return res.status(200).json(redactVehiclePriceDeep(req.user, await tiresService.getVehicleTires(id)));
  } catch (error) {
    return next(failure("Lecture des pneus du véhicule impossible", error));
  }
});

export default router;
