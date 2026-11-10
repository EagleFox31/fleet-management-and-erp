import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { routeIdSchema } from "@shared/contracts/common";
import { GPS_TRACK_ROLES, MISSION_GEO_WRITE_ROLES } from "@shared/constants/roles";
import { db } from "../db";
import { missions } from "@shared/schema";
import { requireFeature } from "../lib/feature-flags";
import { AppError } from "../lib/app-error";
import { gpsCheckAppError, missionGeoColumnsFromBody } from "../lib/gps-points";
import { isCheckViolation, pgConstraintOf } from "../lib/pg-errors";
import { authorize } from "../middleware/auth";
import { missionTrack } from "../services/vehicle-positions-service";

/**
 * Trace et points A/B d'une mission (GPS V1, drapeau `gps`). Monté sur `/api/missions` avant le
 * routeur des missions : `GET /:id/track` et `PATCH /:id/geo` ne passent donc pas par `isStaff`
 * (le chauffeur lit la trace de sa mission).
 *
 * - GET /:id/track : admin, logistics, management, et le chauffeur de la mission (affectation vivante).
 *   Le chef d'atelier lit la dernière position (/api/vehicle-positions) mais pas le trajet.
 * - PATCH /:id/geo : admin, logistics. Mission terminée ou annulée : refusé.
 */
const router = Router();

router.get("/:id/track", requireFeature("gps"), authorize([...GPS_TRACK_ROLES, "driver"]), async (req, res, next) => {
  try {
    const user = req.user!;
    const missionId = routeIdSchema.parse(req.params.id);
    const q = z.object({
      since: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(5000).optional(),
    }).parse(req.query);
    res.json(await missionTrack(user, missionId, { since: q.since ? new Date(q.since) : undefined, limit: q.limit }));
  } catch (error) {
    next(error);
  }
});

const geoPointSchema = z.object({ lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), hubCode: z.string().nullable().optional() });
const geoBodySchema = z.object({ pickup: geoPointSchema.nullable().optional(), delivery: geoPointSchema.nullable().optional() }).strict();

router.patch("/:id/geo", requireFeature("gps"), authorize([...MISSION_GEO_WRITE_ROLES]), async (req, res, next) => {
  try {
    const missionId = routeIdSchema.parse(req.params.id);
    const body = geoBodySchema.parse(req.body ?? {});
    const flat: Record<string, unknown> = {};
    for (const which of ["pickup", "delivery"] as const) {
      const point = body[which];
      if (point === undefined) continue;
      flat[`${which}Lat`] = point?.lat ?? null;
      flat[`${which}Lng`] = point?.lng ?? null;
      flat[`${which}HubCode`] = point?.hubCode ?? null;
    }
    const columns = missionGeoColumnsFromBody(flat);
    if (Object.keys(columns).length === 0) throw new AppError(400, "Aucun point à mettre à jour.");
    const [mission] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission) throw new AppError(404, "Mission introuvable.");
    if (mission.status === "completed" || mission.status === "cancelled") {
      throw new AppError(409, "Mission terminée ou annulée : points non modifiables.");
    }
    try {
      await db.update(missions).set({
          pickupLat: columns.pickupLat,
          pickupLng: columns.pickupLng,
          pickupHubCode: columns.pickupHubCode,
          deliveryLat: columns.deliveryLat,
          deliveryLng: columns.deliveryLng,
          deliveryHubCode: columns.deliveryHubCode,
          updatedAt: new Date(),
        }).where(eq(missions.id, missionId));
    } catch (error) {
      // Filet : la validation ci-dessus précède, la base reste l'arbitre (23514 -> 400 lisible).
      const mapped = isCheckViolation(error) ? gpsCheckAppError(pgConstraintOf(error), error) : null;
      throw mapped ?? error;
    }
    res.json({ missionId, ...columns });
  } catch (error) {
    next(error);
  }
});

export default router;
