import { AppError } from "./app-error";
import { OFFLINE_OWNER_HEADER } from "./idempotency-config";

/**
 * Propriétaire déclaré d'un envoi différé (`X-Offline-Owner`, posé par la file hors ligne et par le
 * tampon GPS du navigateur). Source unique de la comparaison avec la session, partagée par
 * `offlineOwnerGuard` et les routes GPS du chauffeur.
 *
 * Vrai seulement si l'en-tête est présent, de forme stricte (un entier positif, espaces de bord tolérés)
 * et égal à `userId`. Un en-tête vide, une liste (`"1, 2"`, cas d'un en-tête répété que Node joint
 * par une virgule) ou un `userId` absent donnent faux. L'absence d'en-tête se teste avant, chez
 * l'appelant : chaque garde décide s'il laisse passer une requête sans propriétaire déclaré.
 */
/** Lecture d'en-tête minimale : `Request` d'Express la satisfait, un test peut la simuler. */
export type HeaderReader = { get(name: string): string | undefined };

export function ownerHeaderMatches(req: HeaderReader, userId: number | null | undefined): boolean {
  const owner = req.get(OFFLINE_OWNER_HEADER)?.trim();
  if (owner === undefined || !/^\d{1,9}$/.test(owner) || userId == null) return false;
  return Number(owner) === userId;
}

export function offlineOwnerMismatch(): AppError {
  return new AppError(409, "Ces envois appartiennent à un autre compte. Reconnectez-vous avec le compte qui les a enregistrés.", {
    code: "OFFLINE_OWNER_MISMATCH",
  });
}
