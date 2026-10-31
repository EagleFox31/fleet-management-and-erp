import { Router, type RequestHandler } from "express";
import type { FeatureKey } from "@shared/feature-flags";
import { AppError } from "../lib/app-error";
import { requireFeature } from "../lib/feature-flags";
import { authenticate, authorize } from "../middleware/auth";

export type StubMethod = "get" | "post" | "put" | "patch" | "delete";

export type StubRoute = {
  method: StubMethod;
  /** Chemin relatif à `/api`, par exemple `/incidents` ou `/work-orders/:id/quality-check`. */
  path: string;
  /** Si présent, drapeau de `shared/feature-flags.ts` : coupé, la route répond 404. */
  feature?: FeatureKey;
  /** Réservé à l'administrateur. Sinon, tout utilisateur connecté (à resserrer par l'implémenteur). */
  adminOnly?: boolean;
};

/** Handler provisoire : 501 normalisé. Le remplacer par la vraie logique. */
export const notImplemented: RequestHandler = (req, _res, next) => {
  next(new AppError(501, "Cette fonctionnalité n'est pas encore disponible.", { cause: `non implémenté : ${req.method} ${req.path}` }));
};

/**
 * Routeur provisoire d'une ressource du lot (T-08). L'agent propriétaire de la ressource
 * remplace les entrées par ses vraies routes dans le même fichier ; le montage dans
 * `server/api/index.ts` ne change pas. Ordre des gardes : drapeau, session, rôle.
 */
export function createStubRouter(routes: readonly StubRoute[]): Router {
  const router = Router();
  for (const route of routes) {
    const guards: RequestHandler[] = [];
    if (route.feature) guards.push(requireFeature(route.feature));
    guards.push(authenticate);
    if (route.adminOnly) guards.push(authorize(["admin"]));
    router[route.method](route.path, ...guards, notImplemented);
  }
  return router;
}
