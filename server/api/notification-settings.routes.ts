import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_TOPICS,
  notificationSettingsResponseSchema,
  updateNotificationSettingsRequestSchema,
  type NotificationSetting,
} from "@shared/contracts/notification-settings";
import { notificationPreferences } from "@shared/schema";
import { db } from "../db";
import { isFeatureEnabled } from "../lib/feature-flags";
import { authenticate, isAnyUser } from "../middleware/auth";
import { validateBody } from "../middleware/validate-body";

/**
 * Réglages de notification de l'utilisateur connecté (P-12). L'utilisateur vient de la session,
 * jamais du corps (anti-IDOR). Absence de ligne = valeurs par défaut du contrat.
 * `email` n'est pris en compte que si le drapeau `email-notifications` est actif.
 */
async function readSettings(userId: number): Promise<NotificationSetting[]> {
  const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  const byTopic = new Map(rows.map((row) => [row.topic, row]));
  return NOTIFICATION_TOPICS.map((topic, index) => {
    const row = byTopic.get(topic);
    const fallback = DEFAULT_NOTIFICATION_SETTINGS[index];
    return { topic, inApp: row?.inApp ?? fallback.inApp, email: row?.email ?? fallback.email };
  });
}

const getSettings: RequestHandler = async (req, res, next) => {
  try {
    res.status(200).json(notificationSettingsResponseSchema.parse(await readSettings(req.user!.id)));
  } catch (error) {
    next(error);
  }
};

const patchSettings: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const changes = updateNotificationSettingsRequestSchema.parse(req.body);
    const emailEnabled = isFeatureEnabled("email-notifications");

    for (const change of changes) {
      const set: { inApp?: boolean; email?: boolean } = {};
      if (change.inApp !== undefined) set.inApp = change.inApp;
      if (emailEnabled && change.email !== undefined) set.email = change.email;
      if (Object.keys(set).length === 0) continue;
      await db
        .insert(notificationPreferences)
        .values({ userId, topic: change.topic, ...set })
        .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.topic], set: { ...set } });
    }

    res.status(200).json(notificationSettingsResponseSchema.parse(await readSettings(userId)));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/notifications/settings", authenticate, isAnyUser, getSettings);
router.patch("/notifications/settings", authenticate, isAnyUser, validateBody(updateNotificationSettingsRequestSchema), patchSettings);

export default router;
