import { Router } from "express";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import {
  timeTrackingMonthlyStatsQuerySchema,
  timeTrackingQuerySchema,
  upsertTimeTrackingRequestSchema,
} from "@shared/contracts/time-tracking";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { TIME_TRACKING_READ_ROLES, TIME_TRACKING_WRITE_ROLES } from "@shared/constants/roles";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { authorize } from "../middleware/auth";
import { timeTrackingService } from "../services/time-tracking-service";

const log = moduleLogger("time-tracking");
const router = Router();
const feature = requireFeature("time-tracking");
const readers = authorize([...TIME_TRACKING_READ_ROLES]);
const writers = authorize([...TIME_TRACKING_WRITE_ROLES]);

/** Pointage du personnel (P-20). Lecture : administration, logistique, secrétariat, direction. Saisie : administration, logistique. */
router.get("/time-tracking", feature, readers, async (req, res, next) => {
  try {
    res.json(await timeTrackingService.list(timeTrackingQuerySchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

router.get("/time-tracking/monthly-stats", feature, readers, async (req, res, next) => {
  try {
    res.json(await timeTrackingService.monthlyStats(timeTrackingMonthlyStatsQuerySchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

/** Une saisie par personne et par jour : rejouable, la dernière l'emporte. */
router.put("/time-tracking", feature, writers, async (req, res, next) => {
  try {
    const body = upsertTimeTrackingRequestSchema.parse(req.body);
    const [person] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).limit(1);
    if (!person) throw new AppError(404, "Personne introuvable.");
    const entry = await timeTrackingService.upsert(body);

    const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
    if (broadcast) {
      broadcast("time_tracking_updated", {
        userId: entry.userId,
        date: entry.date,
        scope: REALTIME_EVENTS.time_tracking_updated.scope,
      });
    } else {
      log.warn({ requestId: req.requestId }, "diffusion temps réel indisponible");
    }
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

export default router;
