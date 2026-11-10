import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { isFeatureEnabled } from "../lib/feature-flags";
import {
  IDEMPOTENCY_FLAG,
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_ROUTES,
  isPreWriteRefusal,
  isReplayableStatus,
  type IdempotencyRoute,
} from "../lib/idempotency-config";
import { hashRequest, idempotencyStore, type IdempotencyStore } from "../lib/idempotency-store";
import { moduleLogger } from "../lib/logger";
import { API_PREFIX, routedPath } from "../lib/routed-path";

/** Chargé à l'appel : importer la base au chargement casserait les tests unitaires sans base. */
const findActiveSessionUser = async (id: number) => (await import("../services/session-user")).findActiveSessionUser(id);

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

/** Règle de la liste qui couvre l'écriture `method path`, ou `undefined`. */
export function findIdempotentRoute(routes: readonly IdempotencyRoute[], method: string, path: string): IdempotencyRoute | undefined {
  const clean = normalizeIdempotencyPath(path);
  return routes.find((route) => route.method === method.toUpperCase() && route.pattern.test(clean));
}

/** Vrai si l'écriture `method path` figure dans la liste des routes rejouables. */
export function isIdempotentRoute(routes: readonly IdempotencyRoute[], method: string, path: string): boolean {
  return findIdempotentRoute(routes, method, path) !== undefined;
}

/**
 * Garde d'idempotence des écritures (CDC #10b), modèle du brouillon IETF « Idempotency-Key ».
 *
 * Sur une route listée, drapeau `offline-writes` allumé, session ouverte et en-tête présent :
 * - première requête : la clé est réservée, la route s'exécute, sa réponse est enregistrée ;
 * - même clé, même requête, déjà traitée : la réponse enregistrée est rejouée, sans réécrire ;
 * - même clé encore en cours : 409 ; même clé pour une autre requête : 422 ;
 * - 5xx, 401, 403, 408, 429 et les codes de `PRE_WRITE_REFUSAL_CODES` (véhicule retiré) : la clé est
 *   libérée, le client réessaie ;
 * - réponse terminée sans JSON : la clé est libérée ;
 * - connexion coupée : rien n'est libéré, la route peut encore répondre et sa réponse est
 *   enregistrée ; si elle ne répond jamais, la réservation expire (arrêt du serveur compris).
 * Compte supprimé : 401 avant toute réservation. Sans en-tête, la requête passe comme avant.
 * Options par route (`IdempotencyRoute`) : `staleSeconds`, `keepKeyOnUncertainOutcome` (aucune
 * libération sauf 401/403/408/429), `ignoreFeatureFlag`, `inProgressMessage`.
 * Stockage indisponible : 503, rien n'est écrit.
 */
export function idempotencyGuard(
  routes: readonly IdempotencyRoute[] = IDEMPOTENCY_ROUTES,
  store: IdempotencyStore = idempotencyStore,
  findUser: (id: number) => Promise<unknown> = findActiveSessionUser,
): RequestHandler {
  return async (req, res, next) => {
    if (routes.length === 0) return next();
    const method = req.method.toUpperCase();
    // Chemin lu par le routeur (`\`, `//`, forme absolue), pas `originalUrl` brut (#631).
    const path = normalizeIdempotencyPath(routedPath(req).replace(API_PREFIX, ""));
    const route = findIdempotentRoute(routes, method, path);
    if (!route) return next();
    if (!route.ignoreFeatureFlag && !isFeatureEnabled(IDEMPOTENCY_FLAG)) return next();
    const keepKey = route.keepKeyOnUncertainOutcome === true;

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
      // Compte supprimé : 401 comme la route, et pas de réservation sur un compte disparu
      // (sa clé étrangère ferait un 503).
      if (!(await findUser(userId))) return next(new AppError(401, "Session expirée, reconnectez-vous."));
      outcome = await store.reserve(
        { userId, key, method, path, requestHash },
        route.staleSeconds === undefined ? undefined : { staleSeconds: route.staleSeconds },
      );
    } catch (err) {
      return next(new AppError(503, "Service momentanément indisponible, réessayez.", { cause: err }));
    }

    if (outcome.kind === "replay") {
      res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, "true");
      return res.status(outcome.status).json(outcome.body);
    }
    if (outcome.kind === "in_progress") {
      const message = route.inProgressMessage ?? "Cette opération est déjà en cours de traitement. Réessayez dans un instant.";
      return next(new AppError(409, message, { code: "IDEMPOTENCY_IN_PROGRESS" }));
    }
    if (outcome.kind === "mismatch") {
      return next(new AppError(422, "Cette clé d'idempotence a déjà servi pour une autre opération."));
    }

    let settled = false;
    const release = () =>
      store.release(userId, key).catch((err) => log.error({ err, requestId: req.requestId }, "libération de la clé d'idempotence en échec"));

    // Issue incertaine sur une route qui garde sa clé : rien n'est libéré, un réessai reçoit 409.
    const keepUncertain = (reason: string) => {
      log.warn({ requestId: req.requestId, path, reason }, "clé d'idempotence conservée sur une issue incertaine");
      return Promise.resolve();
    };

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (settled) return originalJson(body);
      settled = true;
      const status = res.statusCode;
      const persist = isReplayableStatus(status, body)
        ? store.complete(userId, key, status, body).catch((err) => {
            log.error({ err, requestId: req.requestId }, "enregistrement de la réponse idempotente en échec");
            return keepKey ? keepUncertain("réponse non enregistrée") : release();
          })
        : keepKey && !isPreWriteRefusal(status, body)
          ? keepUncertain(`statut ${status}`)
          : release();
      // La réponse part une fois la clé tranchée : un rejeu immédiat voit l'état final.
      void persist
        .finally(() => originalJson(body))
        .catch((err) => log.error({ err, requestId: req.requestId }, "envoi de la réponse idempotente en échec"));
      return res;
    }) as typeof res.json;

    // Réponse terminée sans JSON : rien n'a été enregistré, la clé est libérée. Une connexion
    // coupée (`close`) ne libère rien : la route peut encore répondre, et libérer ici ferait
    // réexécuter l'écriture au réessai.
    res.on("finish", () => {
      if (settled) return;
      settled = true;
      void (keepKey ? keepUncertain("réponse sans JSON") : release());
    });

    next();
  };
}
