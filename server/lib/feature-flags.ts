import type { NextFunction, Request, Response } from "express";
import {
  parseFeatureOverrides,
  resolveFeatureFlags,
  type FeatureFlagsResponse,
  type FeatureKey,
} from "@shared/feature-flags";
import { AppError } from "./app-error";
import { moduleLogger } from "./logger";

const log = moduleLogger("feature-flags");

/** Valeurs brutes déjà signalées : une entrée illisible n'est journalisée qu'une fois par valeur. */
const reported = new Set<string>();

/**
 * Valeurs effectives des drapeaux : défauts de `shared/feature-flags.ts`, surchargés par la
 * variable `FEATURE_FLAGS`. Lue à chaque appel (coût négligeable) pour que les tests et un
 * redémarrage à chaud voient la même valeur ; les entrées ignorées sont journalisées.
 */
export function getFeatureFlags(raw: string | undefined = process.env.FEATURE_FLAGS): FeatureFlagsResponse {
  const { ignored } = parseFeatureOverrides(raw);
  if (ignored.length > 0 && raw !== undefined && !reported.has(raw)) {
    reported.add(raw);
    log.warn({ ignored }, "entrées FEATURE_FLAGS ignorées (clé inconnue ou valeur illisible)");
  }
  return resolveFeatureFlags(raw);
}

export function isFeatureEnabled(key: FeatureKey, raw?: string): boolean {
  return getFeatureFlags(raw)[key];
}

/** Garde de route : drapeau coupé, la route n'existe pas (404 normalisé). */
export function requireFeature(key: FeatureKey) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    if (isFeatureEnabled(key)) return next();
    next(new AppError(404, "Cette fonctionnalité n'est pas disponible."));
  };
}

/** Pour les tests : oublie les valeurs déjà signalées. */
export function resetFeatureFlagReports(): void {
  reported.clear();
}
