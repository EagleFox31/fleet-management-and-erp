import { Router, type RequestHandler } from "express";
import { createIncidentRequestSchema, incidentsQuerySchema } from "@shared/contracts/incidents";
import { requireFeature } from "../lib/feature-flags";
import { authenticate, authorize, isAnyUser } from "../middleware/auth";
import { createIncident, listIncidents } from "../services/incident-service";

/**
 * Déclaration de panne (P-22). Les règles de périmètre vivent dans le service : client refusé,
 * chauffeur limité à ses véhicules en affectation active, personnel sans restriction.
 * `isAnyUser` charge `req.user` (AGENTS §11). Écriture : réservée au chauffeur (son écran de déclaration)
 * et à l'admin ; comptable, lecteur, RH, magasin, etc. n'ont pas cet écran et ne déclenchent pas l'alerte atelier.
 * Le périmètre chauffeur reste tranché par le service.
 */
const postIncident: RequestHandler = async (req, res, next) => {
  try {
    const input = createIncidentRequestSchema.parse(req.body);
    res.status(201).json(await createIncident(req.user, input));
  } catch (error) {
    next(error);
  }
};

const getIncidents: RequestHandler = async (req, res, next) => {
  try {
    const query = incidentsQuerySchema.parse(req.query);
    res.status(200).json(await listIncidents(req.user, query));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/incidents", requireFeature("incidents"), authenticate, isAnyUser, getIncidents);
router.post("/incidents", requireFeature("incidents"), authenticate, authorize(["driver", "admin"]), postIncident);

export default router;
