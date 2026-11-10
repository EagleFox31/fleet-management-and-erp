import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { findActiveSessionUser } from "../services/session-user";
import { VIEWER_WRITE_ALLOWED } from "@shared/constants/roles";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const VIEWER_READ_ONLY_MESSAGE = "Accès refusé : ce profil est en lecture seule.";

/**
 * Lecteur (`viewer`) : aucune écriture, quelle que soit la route.
 *
 * Monté dans `apiRouter` (server/api/index.ts) avant tout routeur, donc avant `registerRoutes` :
 * couvre aussi `server/routes.ts` et toute route ajoutée plus tard, sans que chaque garde de rôle
 * ait à exclure le lecteur. Seule la fermeture de session est permise (`VIEWER_WRITE_ALLOWED`).
 * Sans session, la route répond elle-même (401), comme avant. Une erreur de base remonte (500),
 * elle ne laisse pas passer l'écriture.
 */
export const viewerReadOnlyGuard: RequestHandler = async (req, _res, next) => {
  try {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();
    if (!req.session?.userId) return next();
    if (VIEWER_WRITE_ALLOWED.some((a) => a.method === req.method.toUpperCase() && a.path === req.path.replace(/\/+$/, ""))) return next();
    const user = await findActiveSessionUser(req.session.userId);
    if (user?.role !== "viewer") return next();
    return next(new AppError(403, VIEWER_READ_ONLY_MESSAGE));
  } catch (error) {
    next(error);
  }
};
