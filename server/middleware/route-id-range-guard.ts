import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { MAX_DB_INTEGER_ID } from "../lib/route-id";

const log = moduleLogger("route-id-range-guard");

export const ROUTE_ID_OUT_OF_RANGE_MESSAGE = "Identifiant invalide.";

/** Segment décodé (`%39` → `9`) ; tel quel si l'encodage est invalide. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Vrai si un segment du chemin commence par un entier hors de la plage des identifiants int4, sous
 * toutes les formes que `parseInt` lit : encodée, signée, suivie de décimales ou de lettres.
 */
export function hasOutOfRangeNumericSegment(path: string): boolean {
  return path.split("/").some((segment) => {
    const leading = /^[+-]?(\d+)/.exec(decodeSegment(segment).trim());
    return leading !== null && Number(leading[1]) > MAX_DB_INTEGER_ID;
  });
}

/**
 * Filet devant tous les routeurs /api (server/api et routes.ts) : un id hors plage int4 ne doit pas
 * atteindre la base (erreur 22003, 500). Refus en 400 sans requête. Aucune route n'accepte de segment
 * commençant par un entier au-delà de cette plage (revue du 5 novembre 2026).
 */
export function routeIdRangeGuard(req: Request, _res: Response, next: NextFunction): void {
  if (hasOutOfRangeNumericSegment(req.path)) {
    log.debug({ requestId: req.requestId, path: req.path }, "identifiant de route hors plage refusé");
    return next(new AppError(400, ROUTE_ID_OUT_OF_RANGE_MESSAGE));
  }
  next();
}
