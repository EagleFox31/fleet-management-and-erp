import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { isTrustedRequestOrigin } from "../lib/allowed-origins";
import { moduleLogger } from "../lib/logger";
import { isApiPath } from "../lib/routed-path";

export const FOREIGN_ORIGIN_MESSAGE = "Requête refusée : cette action n'est pas autorisée depuis ce site.";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const log = moduleLogger("csrf-origin");

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Anti-CSRF par origine : le cookie de session est en `SameSite=None`, et `multipart/form-data` reste
 * une requête simple (sans préflight) que le filtre de type de contenu doit admettre pour les
 * téléversements. Une page tierce peut donc encore POSTer un multipart vide sur une route qui écrit
 * sans lire son corps. Ici, une écriture `/api` venue d'un autre site est refusée (403) avant tout
 * analyseur de corps. Règles et origines admises : `server/lib/allowed-origins.ts`.
 */
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  if (!WRITE_METHODS.has(req.method.toUpperCase()) || !isApiPath(req.path)) return next();
  const origin = headerValue(req.headers.origin);
  const secFetchSite = headerValue(req.headers["sec-fetch-site"]);
  if (isTrustedRequestOrigin({ origin, secFetchSite, host: req.headers.host })) return next();
  log.warn({ origin, secFetchSite, method: req.method, path: req.path, requestId: req.requestId }, "écriture /api refusée : origine non admise");
  return next(new AppError(403, FOREIGN_ORIGIN_MESSAGE));
};
