import type { RequestHandler } from "express";
import { isIP } from "node:net";
import { AppError } from "../lib/app-error";

/**
 * Plafond d'echecs d'authentification par adresse IP (POST /api/auth/login, /api/auth/pin-login).
 * Complement du compteur par compte (login-lockout-guard) : il freine une pulverisation sur de
 * nombreux comptes (PIN a 4 chiffres, liste des chauffeurs publique) depuis une meme adresse.
 *
 * - Build plutot qu'Adopt d'express-rate-limit : le node_modules est partage entre sessions de travail
 *   (installe sous Linux puis copie), une dependance de plus ne s'y installe pas sans risque. A adopter
 *   plus tard, ce module garde la meme semantique (skipSuccessfulRequests, fenetre fixe).
 * - Limite assumee : compteur en memoire, par instance. La production (VPS) n'a qu'une instance.
 * - Jetons : chaque requete en reserve un AVANT le handler (une rafale simultanee est comptee).
 *   Un succes (2xx) ou un corps invalide (400) rend SON jeton, jamais plus, et ne reinitialise pas la
 *   fenetre : intercaler ses propres succes ne libere aucun echec.
 * - Une 5xx reste comptee ici, a l'inverse de la garde par compte qui la rend (une panne n'y est pas un
 *   echec de connexion) : ce plafond est le filet anti-abus, une rafale qui provoque des pannes ne doit
 *   pas en sortir. Tests : `auth-ip-limit.test.ts` (« une 5xx reste comptee » et « 400 et 5xx rendues »).
 * - Adresse : `req.ip` sous `trust proxy 1` (server/app.ts). Seul le saut ajoute par le proxy compte ;
 *   les entrees X-Forwarded-For forgees en amont sont ignorees.
 * - IPv6 : un compteur par /64 (un abonne dispose d'un /64 entier, une adresse par essai contournerait
 *   le plafond et evincerait les compteurs des autres). IPv4 mappee (`::ffff:a.b.c.d`) = l'IPv4.
 * - Memoire bornee : `maxEntries` adresses au plus. Les fenetres expirees sont purgees d'abord, puis
 *   les plus anciennes.
 * - Le 429 ne dit rien du compte vise ; Retry-After donne l'attente en secondes.
 */

/**
 * Cle du compteur pour une adresse : IPv4 telle quelle, IPv4 mappee ramenee a l'IPv4, IPv6 agregee
 * par /64 sous forme developpee (deux ecritures d'une meme adresse donnent la meme cle). Fonction pure.
 */
export function ipBucketKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const bare = ip.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped) return mapped[1];
  if (isIP(bare) !== 6) return bare;
  const [head, tail] = bare.includes("::") ? bare.split("::") : [bare, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // Fin en notation IPv4 (`64:ff9b::1.2.3.4`) : deux groupes, hors du prefixe /64 de toute facon.
  const groupsOf = (parts: string[]) => parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const fill = tail === undefined ? [] : Array(8 - groupsOf(left) - groupsOf(right)).fill("0");
  const groups = [...left, ...fill, ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const AUTH_IP_FAILURE_DEFAULTS = { maxFailures: 20, windowMinutes: 15, maxEntries: 10_000 };

export interface IpFailureLimiterOptions {
  /** Echecs tolérés par fenetre (lu a chaque requete). Defaut : AUTH_IP_FAILURE_MAX ou 20. */
  maxFailures?: () => number;
  /** Duree de la fenetre en ms. Defaut : AUTH_IP_WINDOW_MINUTES ou 15 min. */
  windowMs?: () => number;
  maxEntries?: number;
  now?: () => number;
}

export type IpFailureLimiter = RequestHandler & { size(): number };

export function createIpFailureLimiter(opts: IpFailureLimiterOptions = {}): IpFailureLimiter {
  const maxFailures = opts.maxFailures ?? (() => positive(process.env.AUTH_IP_FAILURE_MAX, AUTH_IP_FAILURE_DEFAULTS.maxFailures));
  const windowMs =
    opts.windowMs ?? (() => positive(process.env.AUTH_IP_WINDOW_MINUTES, AUTH_IP_FAILURE_DEFAULTS.windowMinutes) * 60_000);
  const maxEntries = opts.maxEntries ?? AUTH_IP_FAILURE_DEFAULTS.maxEntries;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { used: number; resetAt: number }>();

  function evict(t: number) {
    for (const [ip, b] of buckets) if (b.resetAt <= t) buckets.delete(ip);
    while (buckets.size >= maxEntries) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  function bucketFor(ip: string, t: number) {
    const current = buckets.get(ip);
    if (current && current.resetAt > t) return current;
    if (current) buckets.delete(ip);
    if (buckets.size >= maxEntries) evict(t);
    const fresh = { used: 0, resetAt: t + windowMs() };
    buckets.set(ip, fresh);
    return fresh;
  }

  const middleware: RequestHandler = (req, res, next) => {
    const t = now();
    const bucket = bucketFor(ipBucketKey(req.ip), t);
    if (bucket.used >= maxFailures()) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - t) / 1000))));
      return next(new AppError(429, "Trop de tentatives depuis cette connexion. Réessayez plus tard.", { code: "RATE_LIMITED" }));
    }
    bucket.used += 1;
    res.once("finish", () => {
      const s = res.statusCode;
      // Rend le seul jeton de cette requete, dans sa propre fenetre.
      if ((s >= 200 && s < 300) || s === 400) bucket.used = Math.max(0, bucket.used - 1);
    });
    next();
  };
  return Object.assign(middleware, { size: () => buckets.size });
}
