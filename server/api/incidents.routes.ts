import { Router, type RequestHandler } from "express";
import { createIncidentRequestSchema, incidentsQuerySchema } from "@shared/contracts/incidents";
import { requireFeature } from "../lib/feature-flags";
import { isVehicleOperationWriter, authenticate, isAnyUser, isStaff } from "../middleware/auth";
import { createIncident, listIncidents } from "../services/incident-service";

/**
 * Déclaration de panne (P-22). Les règles de périmètre vivent dans le service : client refusé,
 * chauffeur limité à ses véhicules en affectation active, personnel sans restriction.
 * `isAnyUser` charge `req.user` (AGENTS §11). Écriture : `isVehicleOperationWriter` écarte le client,
 * le comptable et le lecteur dès la garde
 * (le service le refuse aussi) ; le périmètre chauffeur reste tranché par le service.
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
router.post("/incidents", requireFeature("incidents"), authenticate, isVehicleOperationWriter, postIncident);

export default router;
