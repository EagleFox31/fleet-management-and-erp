import { Router, type RequestHandler } from "express";
import { routeIdSchema } from "@shared/contracts/common";
import { requireFeature } from "../lib/feature-flags";
import { gpsBatchSchema, parseOsmandReport, toGpsPoint } from "../lib/gps-points";
import { AppError } from "../lib/app-error";
import { authorize } from "../middleware/auth";
import { activeMissionIdOf, ingestDriverPositions } from "../services/vehicle-positions-service";

/**
 * Positions du téléphone du chauffeur (GPS V1, drapeau `gps`). Réservé au rôle `driver` (`authorize`, 403 pour
 * tout autre, personnel et client compris : personne ne dépose une position à la place d'un
 * chauffeur) ; le service exige en plus l'affectation vivante à la mission.
 *
 * - POST /api/driver/missions/:id/positions : paquet JSON `{ points: [...] }` (<= 50 points), rejeu
 *   hors ligne sans doublon (clientPointId).
 * - GET|POST /api/driver/positions : relevé unique au format OsmAnd / Traccar Client
 *   (`?id=&lat=&lon=&timestamp=&speed=&bearing=&accuracy=`, formulaire, ou JSON `location.coords`),
 *   repli quand l'appli du chauffeur n'est pas disponible. La mission est celle du chauffeur en route.
 *
 * Les positions sont exclues du journal d'audit (server/lib/audit-config.ts).
 */
const router = Router();

const postBatch: RequestHandler = async (req, res, next) => {
  try {
    const missionId = routeIdSchema.parse(req.params.id);
    const { points } = gpsBatchSchema.parse(req.body);
    const result = await ingestDriverPositions(req.user!, missionId, points.map(toGpsPoint), { requestId: req.requestId });
    res.status(result.accepted > 0 ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
};

const postOsmand: RequestHandler = async (req, res, next) => {
  try {
    const user = req.user!;
    const point = parseOsmandReport(req.query as Record<string, unknown>, req.body, { now: new Date(), userId: user.id, missionId: 0 });
    if (!point) throw new AppError(400, "Position illisible : latitude, longitude et horodatage sont requis.");
    const missionId = await activeMissionIdOf(user);
    // L'identifiant du point dépend de la mission : recalculé une fois celle-ci connue.
    const withMission = parseOsmandReport(req.query as Record<string, unknown>, req.body, { now: new Date(), userId: user.id, missionId });
    const result = await ingestDriverPositions(user, missionId, [withMission ?? point], { requestId: req.requestId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

router.post("/driver/missions/:id/positions", requireFeature("gps"), authorize(["driver"]), postBatch);
router.get("/driver/positions", requireFeature("gps"), authorize(["driver"]), postOsmand);
router.post("/driver/positions", requireFeature("gps"), authorize(["driver"]), postOsmand);

export default router;
