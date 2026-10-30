/**
 * Préférences de notification par thème (P-12).
 *
 * Le champ `email` est dans le contrat pour un ajout futur sans rupture, mais
 * tant que le drapeau `email-notifications` est coupé l'écran ne l'affiche pas
 * et le serveur l'ignore (ADR 0001, écarts).
 */
import { z } from "zod";

export const NOTIFICATION_SETTINGS_PATH = "/api/notifications/settings";

export const NOTIFICATION_TOPICS = [
  "maintenance",
  "inventory",
  "work_order",
  "fuel",
  "mission",
  "procurement",
  "documents",
  "incidents",
  "backups",
] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export const notificationSettingSchema = z.object({
  topic: z.enum(NOTIFICATION_TOPICS),
  inApp: z.boolean(),
  email: z.boolean(),
});

/** Toujours un élément par thème, dans l'ordre de `NOTIFICATION_TOPICS` (défaut : in-app oui, e-mail non). */
export const notificationSettingsResponseSchema = z.array(notificationSettingSchema);

/** Mise à jour partielle : seuls les thèmes envoyés changent. */
export const updateNotificationSettingsRequestSchema = z
  .array(notificationSettingSchema.partial({ inApp: true, email: true }))
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.topic)).size === rows.length, { message: "Un thème est présent deux fois." });

export type NotificationSetting = z.infer<typeof notificationSettingSchema>;
export type UpdateNotificationSettingsRequest = z.infer<typeof updateNotificationSettingsRequestSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: readonly NotificationSetting[] = NOTIFICATION_TOPICS.map((topic) => ({
  topic,
  inApp: true,
  email: false,
}));
