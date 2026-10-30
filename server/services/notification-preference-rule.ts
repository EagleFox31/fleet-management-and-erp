export type NotificationChannel = "inApp" | "email";

/** Règle pure : sans ligne, in-app actif et e-mail coupé (défaut du contrat). */
export function isChannelEnabled(row: { inApp: boolean; email: boolean } | undefined, channel: NotificationChannel): boolean {
  return row ? row[channel] : channel === "inApp";
}
