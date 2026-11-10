import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { IDEMPOTENCY_HEADER, OFFLINE_OWNER_HEADER } from "../lib/idempotency-config";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("offline-owner-guard");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Garde du propriétaire d'un envoi différé (V5b-2b, bloquant 1 de la revue sécurité).
 *
 * La file hors ligne envoie `X-Offline-Owner: <id du compte qui a mis l'envoi en file>` avec chaque
 * rejeu. Le cookie de session est partagé entre les onglets : si un autre compte se connecte dans un
 * autre onglet pendant la boucle de rejeu, les envois suivants partiraient sous ce compte avec une
 * clé neuve, exécutés et attribués à lui. Ce garde compare l'en-tête à la session AVANT toute
 * réservation de clé et toute écriture : 409 `OFFLINE_OWNER_MISMATCH`, rien n'est écrit, la file est
 * gardée côté client.
 *
 * Générique : il s'applique à toute écriture qui porte `Idempotency-Key` et `X-Offline-Owner`,
 * sans liste de routes. Sans l'un des deux en-têtes, ou sans session (la route répondra 401), la
 * requête passe comme avant.
 */
export function offlineOwnerGuard(): RequestHandler {
  return (req, _res, next) => {
    if (!WRITE_METHODS.has(req.method.toUpperCase())) return next();
    const owner = req.get(OFFLINE_OWNER_HEADER);
    if (owner === undefined || req.get(IDEMPOTENCY_HEADER) === undefined) return next();
    const userId = req.session?.userId;
    if (!userId) return next();
    if (/^\d{1,9}$/.test(owner.trim()) && Number(owner.trim()) === userId) return next();
    // Pas d'identifiant dans le journal : seulement le fait.
    log.warn({ requestId: req.requestId }, "envoi différé refusé : la session n'est pas celle de son propriétaire");
    return next(
      new AppError(409, "Ces envois appartiennent à un autre compte. Reconnectez-vous avec le compte qui les a enregistrés.", {
        code: "OFFLINE_OWNER_MISMATCH",
      }),
    );
  };
}
