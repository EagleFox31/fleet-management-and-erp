import { Router, type RequestHandler } from "express";
import { routeIdSchema } from "@shared/contracts/common";
import { requireFeature } from "../lib/feature-flags";
import { gpsBatchSchema, parseOsmandReport, toGpsPoint } from "../lib/gps-points";
import { AppError } from "../lib/app-error";
import { OFFLINE_OWNER_HEADER } from "../lib/idempotency-config";
import { moduleLogger } from "../lib/logger";
import { offlineOwnerMismatch, ownerHeaderMatches } from "../lib/offline-owner";
import { authorize } from "../middleware/auth";
import { createKeyedRateLimiter } from "../middleware/keyed-rate-limit";
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
 *
 * Débit plafonné (seau à jetons, server/middleware/keyed-rate-limit.ts), au-delà : 429 `GPS_RATE_LIMITED`
 * avec Retry-After ; le client garde le paquet en tampon (`shouldDropBatch`) et le renvoie au vidage suivant.
 * - Paquets : par chauffeur et par mission. Le téléphone vide son tampon toutes les 2 min ; la rafale
 *   (20 par défaut = tampon plein de 1 000 points / 50 par paquet) laisse partir d'un coup un tampon
 *   accumulé hors ligne, puis un paquet toutes les 10 s.
 * - OsmAnd : par chauffeur seulement, la mission n'étant connue que dans le handler (un chauffeur n'a
 *   qu'une mission en route). Un relevé par requête : rafale 30, puis un relevé toutes les 5 s.
 * Réglages : GPS_BATCH_BURST, GPS_BATCH_REFILL_SECONDS, GPS_OSMAND_BURST, GPS_OSMAND_REFILL_SECONDS.
 */
const router = Router();
const log = moduleLogger("driver-positions");

export const GPS_RATE_DEFAULTS = { batchBurst: 20, batchRefillSeconds: 10, osmandBurst: 30, osmandRefillSeconds: 5 };

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const RATE_MESSAGE = "Positions envoyées trop souvent. Elles restent sur le téléphone et repartiront automatiquement.";

const batchRateLimit = createKeyedRateLimiter({
  keyOf: (req) => `${req.user!.id}:${req.params.id}`,
  capacity: () => Math.max(1, Math.floor(positive(process.env.GPS_BATCH_BURST, GPS_RATE_DEFAULTS.batchBurst))),
  refillMs: () => positive(process.env.GPS_BATCH_REFILL_SECONDS, GPS_RATE_DEFAULTS.batchRefillSeconds) * 1000,
  code: "GPS_RATE_LIMITED",
  message: RATE_MESSAGE,
});

const osmandRateLimit = createKeyedRateLimiter({
  keyOf: (req) => String(req.user!.id),
  capacity: () => Math.max(1, Math.floor(positive(process.env.GPS_OSMAND_BURST, GPS_RATE_DEFAULTS.osmandBurst))),
  refillMs: () => positive(process.env.GPS_OSMAND_REFILL_SECONDS, GPS_RATE_DEFAULTS.osmandRefillSeconds) * 1000,
  code: "GPS_RATE_LIMITED",
  message: RATE_MESSAGE,
});

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
  if (req.get(OFFLINE_OWNER_HEADER) === undefined || ownerHeaderMatches(req, req.user?.id)) return next();
  // Pas d'identifiant dans le journal : seulement le fait.
  log.warn({ requestId: req.requestId }, "positions différées refusées : la session n'est pas celle de leur propriétaire");
  next(offlineOwnerMismatch());
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

router.post("/driver/missions/:id/positions", requireFeature("gps"), authorize(["driver"]), jsonOnly, ownerMatchesSession, batchRateLimit, postBatch);
router.post("/driver/positions", requireFeature("gps"), authorize(["driver"]), jsonOnly, osmandRateLimit, postOsmand);

export default router;
