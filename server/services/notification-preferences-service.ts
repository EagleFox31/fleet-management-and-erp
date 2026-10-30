import { and, eq, inArray } from "drizzle-orm";
import type { NotificationTopic } from "@shared/contracts/notification-settings";
import { notificationPreferences } from "@shared/schema";
import { db } from "../db";
import { moduleLogger } from "../lib/logger";

import { isChannelEnabled, type NotificationChannel } from "./notification-preference-rule";

const log = moduleLogger("notification-preferences");

/**
 * Parmi `userIds`, ceux qui veulent recevoir `topic` sur `channel`. Une seule requête pour tout le lot.
 * Repli « tout actif » si la lecture échoue : une alerte en trop vaut mieux qu'une alerte perdue.
 */
export async function filterUsersByTopic(
  userIds: readonly number[],
  topic: NotificationTopic,
  channel: NotificationChannel = "inApp",
): Promise<number[]> {
  if (userIds.length === 0) return [];
  try {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.topic, topic), inArray(notificationPreferences.userId, [...userIds])));
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    return userIds.filter((id) => isChannelEnabled(byUser.get(id), channel));
  } catch (err) {
    log.error({ err, topic }, "préférences de notification illisibles, tous les destinataires conservés");
    return [...userIds];
  }
}

export async function shouldNotify(userId: number, topic: NotificationTopic, channel: NotificationChannel = "inApp"): Promise<boolean> {
  return (await filterUsersByTopic([userId], topic, channel)).length === 1;
}
