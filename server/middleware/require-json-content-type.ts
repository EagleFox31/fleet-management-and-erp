import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { isApiPath } from "../lib/routed-path";

export const UNSUPPORTED_CONTENT_TYPE_MESSAGE =
  "Format de requête non pris en charge : cette action n'accepte que du JSON.";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACCEPTED_TYPES = new Set(["application/json", "multipart/form-data"]);

/** `Content-Type` réduit au type, sans paramètre (`; charset=…`, `; boundary=…`), en minuscules. */
export function mediaTypeOf(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

function carriesBody(headers: { "content-length"?: string; "transfer-encoding"?: string }): boolean {
  if (headers["transfer-encoding"] !== undefined) return true;
  const length = Number.parseInt(headers["content-length"] ?? "", 10);
  return Number.isFinite(length) && length > 0;
}

/**
 * Anti-CSRF par type de contenu : toute écriture `/api` exige `application/json` ou
 * `multipart/form-data`.
 *
 * Le cookie de session est en `SameSite=None` et aucune route n'a de jeton CSRF. Un formulaire HTML
 * hébergé sur un autre site peut pourtant POSTer en `application/x-www-form-urlencoded`,
 * `multipart/form-data` ou `text/plain` sans préflight CORS, cookies de la victime joints. Seul
 * `application/json` oblige le navigateur à demander un préflight, que la liste d'origines de
 * `server/app.ts` refuse aux sites tiers. `express.urlencoded` (monté juste après) aurait lu ce
 * corps comme n'importe quel JSON : ce garde passe donc avant tout analyseur de corps.
 *
 * - POST : le type est exigé même sans corps, un `fetch` cross-site sans corps et sans en-tête est
 *   une requête simple.
 * - PUT, PATCH, DELETE : méthodes qui déclenchent toujours un préflight cross-site. Le type n'est
 *   exigé que si un corps est joint (un DELETE sans corps reste permis aux clients légitimes).
 * - `multipart/form-data` reste admis pour les téléversements (multer). Il est lui aussi forgeable
 *   depuis un formulaire : les routes d'upload se protègent par leur garde de rôle et leur lecture
 *   stricte des champs, la fermeture complète relève d'un contrôle d'`Origin` (voir la PR).
 * - Aucune exception : l'inventaire n'a trouvé aucun webhook entrant ni callback hors `/api`.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (!WRITE_METHODS.has(req.method.toUpperCase()) || !isApiPath(req.path)) return next();
  if (req.method.toUpperCase() !== "POST" && !carriesBody(req.headers)) return next();
  if (ACCEPTED_TYPES.has(mediaTypeOf(req.headers["content-type"]))) return next();
  return next(new AppError(415, UNSUPPORTED_CONTENT_TYPE_MESSAGE));
};
