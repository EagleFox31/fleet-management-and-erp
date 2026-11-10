import { Router, type RequestHandler } from "express";
import { routeIdSchema } from "@shared/contracts/common";
import { requireFeature } from "../lib/feature-flags";
import { gpsBatchSchema, parseOsmandReport, toGpsPoint } from "../lib/gps-points";
import { AppError } from "../lib/app-error";
import { OFFLINE_OWNER_HEADER } from "../lib/idempotency-config";
import { authorize } from "../middleware/auth";
import { activeMissionIdOf, ingestDriverPositions } from "../services/vehicle-positions-service";

/**
 * Positions du téléphone du chauffeur (GPS V1, drapeau `gps`). Réservé au rôle `driver` (`authorize`, 403 pour
 * tout autre, personnel et client compris : personne ne dépose une position à la place d'un
 * chauffeur) ; le service exige en plus l'affectation vivante à la mission.
 *
 * - POST /api/driver/missions/:id/positions : paquet JSON `{ points: [...] }` (<= 50 points), rejeu
 *   hors ligne sans doublon (clientPointId).
 * - POST /api/driver/positions : relevé unique au format OsmAnd / Traccar Client, en JSON
 *   (`location.coords` ou `{ lat, lon, timestamp, speed, bearing, accuracy }`). La mission est celle du
 *   chauffeur en route.
 *
 * Écriture : POST et `application/json` seulement (415 sinon). Le cookie de session est en
 * SameSite=None sans jeton CSRF : une écriture par GET, par formulaire ou en `text/plain` serait
 * déclenchable depuis un autre site. Un type JSON impose une requête préalable (CORS) que le navigateur
 * n'envoie pas pour un site tiers. La lecture par la requête (`?lat=&lon=`) et le formulaire reviendront
 * avec le jeton d'appareil (lot balises).
 *
 * Les positions sont exclues du journal d'audit (server/lib/audit-config.ts).
 */
const router = Router();

const jsonOnly: RequestHandler = (req, _res, next) => {
  if (!req.is("application/json")) {
    next(new AppError(415, "Format non pris en charge : la position s'envoie en JSON."));
    return;
  }
  next();
};

/**
 * Propriétaire déclaré du paquet (`X-Offline-Owner`, posé par le tampon du navigateur) : le cookie est
 * partagé entre onglets, un autre compte connecté entre-temps ne doit pas recevoir les points de l'ancien.
 * Sans l'en-tête, la requête passe comme avant.
 */
const ownerMatchesSession: RequestHandler = (req, _res, next) => {
  const owner = req.get(OFFLINE_OWNER_HEADER);
  if (owner === undefined || (/^\d{1,9}$/.test(owner.trim()) && Number(owner.trim()) === req.user?.id)) return next();
  next(
    new AppError(409, "Ces envois appartiennent à un autre compte. Reconnectez-vous avec le compte qui les a enregistrés.", {
      code: "OFFLINE_OWNER_MISMATCH",
    }),
  );
};

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
    const missionId = await activeMissionIdOf(user);
    // L'identifiant du point dépend de la mission : le relevé se décode une fois celle-ci connue.
    const point = parseOsmandReport(req.body, { now: new Date(), userId: user.id, missionId });
    if (!point) throw new AppError(400, "Position illisible : latitude, longitude et horodatage valides sont requis.");
    const result = await ingestDriverPositions(user, missionId, [point], { requestId: req.requestId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

router.post("/driver/missions/:id/positions", requireFeature("gps"), authorize(["driver"]), jsonOnly, ownerMatchesSession, postBatch);
router.post("/driver/positions", requireFeature("gps"), authorize(["driver"]), jsonOnly, postOsmand);

export default router;
