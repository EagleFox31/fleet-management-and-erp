import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isLocked, lockoutConfigFromEnv, normalizeUsername, type LockoutStore } from "../services/login-lockout-service";

const log = moduleLogger("login-lockout");

export interface LockoutGuardOptions {
  store: LockoutStore;
  now?: () => Date;
  /** Champ du corps portant l'identifiant (defaut "username"). */
  usernameField?: string;
  /** Prefixe de la cle du compteur : separe les espaces (mot de passe, PIN, changement de mot de passe). */
  keyPrefix?: string;
  /**
   * Identifiant compte, a la place du champ du corps : pour une route sous session
   * (changement de mot de passe), la cle est le compte de session, jamais une saisie.
   */
  /** Message du 429 (defaut : tentatives de connexion). */
  lockedMessage?: string;
  keyOf?: (req: Parameters<RequestHandler>[0]) => string | number | null | undefined;
}

/**
 * Avant : compte verrouille -> 429 RATE_LIMITED + lockedUntil (meme corps pour un nom inconnu).
 * Apres (res.on("finish")) : 401 incremente, 2xx remet a zero.
 * Le 429 est une AppError : lockedUntil part dans le corps via AppError.details (T-08).
 */
export function loginLockoutGuard(opts: LockoutGuardOptions): RequestHandler {
  const now = opts.now ?? (() => new Date());
  const field = opts.usernameField ?? "username";
  return async (req, res, next) => {
    const raw = normalizeUsername(opts.keyOf ? opts.keyOf(req) : req.body?.[field]);
    const username = raw ? (opts.keyPrefix ?? "") + raw : raw;
    if (!username) return next();
    const requestId = (req as { requestId?: string }).requestId;
    try {
      const state = await opts.store.get(username);
      if (isLocked(state, now())) {
        return next(
          new AppError(429, opts.lockedMessage ?? "Trop de tentatives de connexion. Réessayez plus tard.", {
            code: "RATE_LIMITED",
            details: { lockedUntil: state.lockedUntil!.toISOString() },
          }),
        );
      }
    } catch (err) {
      log.error({ err, requestId }, "lecture du verrou impossible");
      return next();
    }
    res.on("finish", () => {
      const cfg = lockoutConfigFromEnv();
      let write: Promise<unknown> = Promise.resolve();
      if (res.statusCode === 401) write = opts.store.registerFailure(username, now(), cfg);
      else if (res.statusCode >= 200 && res.statusCode < 300) write = opts.store.reset(username);
      write.catch((err) => log.error({ err, requestId }, "mise a jour du compteur d'echecs impossible"));
    });
    next();
  };
}
