import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { findActiveSessionUser } from "../services/session-user";
import { matchesAllowedWrite } from "@shared/constants/roles";
import { normalizeRole } from "./auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const VIEWER_READ_ONLY_MESSAGE = "Accès refusé : ce profil est en lecture seule.";

/**
 * Lecteur (`viewer`) : aucune écriture, quelle que soit la route.
 *
 * Monté dans `apiRouter` (server/api/index.ts) avant tout routeur, donc avant `registerRoutes` :
 * couvre aussi `server/routes.ts` et toute route ajoutée plus tard, sans que chaque garde de rôle
 * ait à exclure le lecteur. Seuls la session et le libre-service restent permis (`VIEWER_WRITE_ALLOWED`).
 * Sans session, la route répond elle-même (401), comme avant. Une erreur de base remonte (500),
 * elle ne laisse pas passer l'écriture. Le rôle est normalisé (`normalizeRole`) : un rôle stocké
 * « Viewer » ou « lecteur » est staff pour `isStaff`, il doit l'être aussi pour cette garde.
 * Le rôle est toujours relu depuis la session (`findActiveSessionUser`), jamais depuis `req.user` :
 * aucun middleware ne le pose avant cette garde, et un `req.user` posé ailleurs ne garantit pas
 * qu'il corresponde à `req.session.userId`.
 */
export const viewerReadOnlyGuard: RequestHandler = async (req, _res, next) => {
  try {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();
    if (!req.session?.userId) return next();
    if (matchesAllowedWrite(req.method, req.path)) return next();
    const role = (await findActiveSessionUser(req.session.userId))?.role;
    if (normalizeRole(role) !== "viewer") return next();
    return next(new AppError(403, VIEWER_READ_ONLY_MESSAGE));
  } catch (error) {
    next(error);
  }
};
