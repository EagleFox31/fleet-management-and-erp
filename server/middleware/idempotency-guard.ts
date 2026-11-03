import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { isFeatureEnabled } from "../lib/feature-flags";
import {
  IDEMPOTENCY_FLAG,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_ROUTES,
  isReplayableStatus,
  type IdempotencyRoute,
} from "../lib/idempotency-config";
import { hashRequest, idempotencyStore, type IdempotencyStore } from "../lib/idempotency-store";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("idempotency-guard");

/** Chemin normalisé comme Express et le journal d'audit : sans casse, décodé, sans `/` final. */
export function normalizeIdempotencyPath(path: string): string {
  const rawPath = path.split("?")[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Encodage invalide : on garde le chemin brut.
  }
  return decoded.toLowerCase().replace(/\/+$/, "") || "/";
}

/** Vrai si l'écriture `method path` figure dans la liste des routes rejouables. */
export function isIdempotentRoute(routes: readonly IdempotencyRoute[], method: string, path: string): boolean {
  const clean = normalizeIdempotencyPath(path);
  return routes.some((route) => route.method === method.toUpperCase() && route.pattern.test(clean));
}

/**
 * Garde d'idempotence des écritures (CDC #10b), modèle du brouillon IETF « Idempotency-Key ».
 *
 * Sur une route listée, drapeau `offline-writes` allumé, session ouverte et en-tête présent :
 * - première requête : la clé est réservée, la route s'exécute, sa réponse est enregistrée ;
 * - même clé, même requête, déjà traitée : la réponse enregistrée est rejouée, sans réécrire ;
 * - même clé encore en cours : 409 ; même clé pour une autre requête : 422 ;
 * - 5xx, 401, 403, 408, 429 ou réponse interrompue : la clé est libérée, le client réessaie.
 * Sans en-tête, la requête passe comme avant. Stockage indisponible : 503, rien n'est écrit.
 */
export function idempotencyGuard(
  routes: readonly IdempotencyRoute[] = IDEMPOTENCY_ROUTES,
  store: IdempotencyStore = idempotencyStore,
): RequestHandler {
  return async (req, res, next) => {
    if (routes.length === 0 || !isFeatureEnabled(IDEMPOTENCY_FLAG)) return next();
    const method = req.method.toUpperCase();
    const path = normalizeIdempotencyPath(req.originalUrl.replace(/^\/api/i, ""));
    if (!isIdempotentRoute(routes, method, path)) return next();

    const rawKey = req.get(IDEMPOTENCY_HEADER);
    if (rawKey === undefined) return next();
    const userId = req.session?.userId;
    // Sans session, la route répondra 401 : rien à protéger.
    if (!userId) return next();
    const key = rawKey.trim();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      return next(new AppError(400, "Clé d'idempotence invalide."));
    }

    const requestHash = hashRequest(method, path, req.body);
    let outcome;
    try {
      outcome = await store.reserve({ userId, key, method, path, requestHash });
    } catch (err) {
      return next(new AppError(503, "Service momentanément indisponible, réessayez.", { cause: err }));
    }

    if (outcome.kind === "replay") {
      res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, "true");
      return res.status(outcome.status).json(outcome.body);
    }
    if (outcome.kind === "in_progress") {
      return next(new AppError(409, "Cette opération est déjà en cours de traitement. Réessayez dans un instant."));
    }
    if (outcome.kind === "mismatch") {
      return next(new AppError(422, "Cette clé d'idempotence a déjà servi pour une autre opération."));
    }

    let settled = false;
    const release = () =>
      store.release(userId, key).catch((err) => log.error({ err, requestId: req.requestId }, "libération de la clé d'idempotence en échec"));

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (settled) return originalJson(body);
      settled = true;
      const status = res.statusCode;
      const persist = isReplayableStatus(status)
        ? store.complete(userId, key, status, body).catch((err) => {
            log.error({ err, requestId: req.requestId }, "enregistrement de la réponse idempotente en échec");
            return release();
          })
        : release();
      // La réponse part une fois la clé tranchée : un rejeu immédiat voit l'état final.
      void persist.finally(() => originalJson(body));
      return res;
    }) as typeof res.json;

    // Réponse sans JSON ou connexion coupée avant la réponse : la clé ne doit pas rester bloquée.
    res.on("close", () => {
      if (settled) return;
      settled = true;
      void release();
    });

    next();
  };
}
