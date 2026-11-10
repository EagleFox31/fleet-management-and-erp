import type { Request, RequestHandler } from "express";
import type { ApiErrorCode } from "@shared/errors";
import { AppError } from "../lib/app-error";

/**
 * Limiteur de débit par clé (seau à jetons), pour une route déjà authentifiée.
 *
 * - Adapt de `auth-ip-limit.ts` (même éviction bornée, même Retry-After, même Build plutôt qu'Adopt
 *   d'express-rate-limit : node_modules partagé). Sémantique différente : ici chaque requête consomme
 *   un jeton, succès compris ; là-bas seuls les échecs comptent.
 * - Seau : `capacity` jetons au plus (la rafale tolérée), un jeton rendu toutes les `refillMs`.
 *   Une requête refusée ne consomme rien : l'attente annoncée par Retry-After suffit toujours.
 * - `capacity` et `refillMs` sont lus à chaque requête (réglables par l'environnement sans redémarrer
 *   le module, et par les tests).
 * - Limite assumée : état en mémoire, par instance. La production (VPS) n'a qu'une instance.
 * - Mémoire bornée : `maxEntries` clés au plus. Les seaux redevenus pleins (équivalents à une clé
 *   inconnue) sont purgés d'abord, puis les moins récemment servis.
 */
export interface KeyedRateLimiterOptions {
  keyOf: (req: Request) => string;
  capacity: () => number;
  refillMs: () => number;
  code: ApiErrorCode;
  message: string;
  maxEntries?: number;
  now?: () => number;
}

export type KeyedRateLimiter = RequestHandler & { size(): number };

export function createKeyedRateLimiter(opts: KeyedRateLimiterOptions): KeyedRateLimiter {
  const maxEntries = opts.maxEntries ?? 10_000;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; at: number }>();

  const level = (b: { tokens: number; at: number }, t: number, capacity: number, refillMs: number) =>
    Math.min(capacity, b.tokens + Math.max(0, t - b.at) / refillMs);

  function evict(t: number, capacity: number, refillMs: number) {
    for (const [key, b] of buckets) if (level(b, t, capacity, refillMs) >= capacity) buckets.delete(key);
    while (buckets.size >= maxEntries) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  const limiter: RequestHandler = (req, res, next) => {
    const t = now();
    const capacity = opts.capacity();
    const refillMs = opts.refillMs();
    const key = opts.keyOf(req);
    const known = buckets.get(key);
    if (!known) evict(t, capacity, refillMs);
    const tokens = known ? level(known, t, capacity, refillMs) : capacity;
    if (tokens < 1) {
      res.setHeader("Retry-After", String(Math.ceil(((1 - tokens) * refillMs) / 1000)));
      return next(new AppError(429, opts.message, { code: opts.code }));
    }
    // Réinsertion : l'ordre de la Map suit le dernier service, l'éviction vise les moins récents.
    buckets.delete(key);
    buckets.set(key, { tokens: tokens - 1, at: t });
    next();
  };

  return Object.assign(limiter, { size: () => buckets.size });
}
