/**
 * Règle d'échéance des documents véhicule typés (T-17a).
 * Pure: pas d'accès base, testable sans DB. L'horloge est injectée.
 */

import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";

export { todayUtcDateOnly };

export const DEFAULT_ALERT_DAYS = 30;

export type DocumentExpiryStatus = "none" | "due" | "expired";

/** Jours calendaires entre `today` et une date `YYYY-MM-DD` (date UTC, sans heure). Négatif = échu, 0 = jour J. */
export function daysUntilExpiry(expiryDate: string, today: Date): number | null {
  const expiry = toExpiryDateOnly(expiryDate);
  return expiry === null ? null : daysBetweenDateOnly(expiry, todayUtcDateOnly(today));
}

/**
 * `expired` dès le jour J (`days <= 0` : une échéance aujourd'hui bloque, D2), `due` de
 * J+1 à J+alertDays inclus, `none` au-delà ou date invalide. La clé de dédoublonnage
 * passe donc de `due` à `expired` le jour J : l'alerte critique est émise ce jour-là.
 */
export function classifyDocumentExpiry(
  expiryDate: string | null | undefined,
  today: Date,
  alertDays: number = DEFAULT_ALERT_DAYS,
): { status: DocumentExpiryStatus; days: number | null } {
  if (!expiryDate) return { status: "none", days: null };
  const days = daysUntilExpiry(expiryDate, today);
  if (days === null) return { status: "none", days: null };
  if (days <= 0) return { status: "expired", days };
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
