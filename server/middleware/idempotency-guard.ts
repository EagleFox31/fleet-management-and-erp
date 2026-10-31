import type { RequestHandler } from "express";
import { isFeatureEnabled } from "../lib/feature-flags";
import { IDEMPOTENCY_ROUTES, type IdempotencyRoute } from "../lib/idempotency-config";

/** Vrai si l'écriture `method path` figure dans la liste des routes rejouables. */
export function isIdempotentRoute(routes: readonly IdempotencyRoute[], method: string, path: string): boolean {
  // Meme normalisation qu'Express et que le journal d'audit : sans casse, chemin decode.
  const rawPath = path.split("?")[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Encodage invalide : on garde le chemin brut.
  }
  const clean = decoded.toLowerCase().replace(/\/+$/, "") || "/";
  return routes.some((route) => route.method === method.toUpperCase() && route.pattern.test(clean));
}

/**
 * Garde d'idempotence des écritures (CDC #10). Squelette « à blanc » : transmet toujours la
 * requête. Le lot #10b y ajoute la lecture de `Idempotency-Key`, le rejeu de la réponse
 * enregistrée et l'écriture dans `idempotency_keys` (table du lot DB-1).
 *
 * Sans effet tant que le drapeau `technician-offline` est coupé ou que la liste est vide.
 * Ce n'est pas une route : drapeau coupé, la requête passe (pas de 404).
 */
export function idempotencyGuard(routes: readonly IdempotencyRoute[] = IDEMPOTENCY_ROUTES): RequestHandler {
  return (req, _res, next) => {
    if (routes.length === 0 || !isFeatureEnabled("technician-offline")) return next();
    if (!isIdempotentRoute(routes, req.method, req.originalUrl.replace(/^\/api/, ""))) return next();
    // Lot #10b : traitement de la clé d'idempotence.
    next();
  };
}
