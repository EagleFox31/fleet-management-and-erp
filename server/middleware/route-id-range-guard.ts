import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { MAX_DB_INTEGER_ID } from "../lib/route-id";

const log = moduleLogger("route-id-range-guard");

export const ROUTE_ID_OUT_OF_RANGE_MESSAGE = "Identifiant invalide.";

/** Vrai si un segment entièrement numérique du chemin dépasse la plage des identifiants int4. */
export function hasOutOfRangeNumericSegment(path: string): boolean {
  return path.split("/").some((segment) => /^\d+$/.test(segment) && Number(segment) > MAX_DB_INTEGER_ID);
}

/**
 * Filet devant tous les routeurs /api (server/api et routes.ts) : un id hors plage int4 ne doit pas
 * atteindre la base (erreur 22003, 500). Refus en 400 sans requête. Aucune route n'accepte de segment
 * numérique au-delà de cette plage (revue du 5 novembre 2026).
 */
export function routeIdRangeGuard(req: Request, _res: Response, next: NextFunction): void {
  if (hasOutOfRangeNumericSegment(req.path)) {
    log.debug({ requestId: req.requestId, path: req.path }, "identifiant de route hors plage refusé");
    return next(new AppError(400, ROUTE_ID_OUT_OF_RANGE_MESSAGE));
  }
  next();
}
