/**
 * Règle d'échéance des documents véhicule typés (T-17a).
 * Pure: pas d'accès base, testable sans DB. L'horloge est injectée.
 */

export const DEFAULT_ALERT_DAYS = 30;

export type DocumentExpiryStatus = "none" | "due" | "expired";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Jours calendaires entre `today` et une date `YYYY-MM-DD` (UTC, sans heure). Négatif = échu. */
export function daysUntilExpiry(expiryDate: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate);
  if (!match) return null;
  const expiry = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((expiry - base) / MS_PER_DAY);
}

/** `due` de J+0 à J+alertDays inclus, `expired` si échu, `none` au-delà ou date invalide. */
export function classifyDocumentExpiry(
  expiryDate: string | null | undefined,
  today: Date,
  alertDays: number = DEFAULT_ALERT_DAYS,
): { status: DocumentExpiryStatus; days: number | null } {
  if (!expiryDate) return { status: "none", days: null };
  const days = daysUntilExpiry(expiryDate, today);
  if (days === null) return { status: "none", days: null };
  if (days < 0) return { status: "expired", days };
  if (days <= alertDays) return { status: "due", days };
  return { status: "none", days };
}

/** Clé stable par document ET échéance: une nouvelle échéance (renouvellement) réarme l'alerte. */
export function documentExpiryDedupeKey(
  documentId: number,
  expiryDate: string,
  status: Exclude<DocumentExpiryStatus, "none">,
): string {
  return `doc_expiry:${status}:${documentId}:${expiryDate.slice(0, 10)}`;
}

/** Préfixes des clés d'échéance d'un document, toutes échéances confondues (levée au renouvellement). */
export function documentExpiryDedupeKeyPrefixes(documentId: number): string[] {
  return (["due", "expired"] as const).map((status) => `doc_expiry:${status}:${documentId}:`);
}
