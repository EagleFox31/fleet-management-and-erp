import type { RequestHandler } from "express";
import { moduleLogger } from "../lib/logger";
import { isLocked, lockoutConfigFromEnv, normalizeUsername, type LockoutStore } from "../services/login-lockout-service";

const log = moduleLogger("login-lockout");

export interface LockoutGuardOptions {
  store: LockoutStore;
  now?: () => Date;
  /** Champ du corps portant l'identifiant (defaut "username"). */
  usernameField?: string;
}

/**
 * Avant : compte verrouille -> 429 RATE_LIMITED + lockedUntil (meme corps pour un nom inconnu).
 * Apres (res.on("finish")) : 401 incremente, 2xx remet a zero.
 * AppError.details (T-08) n'existe pas encore : le corps est ecrit directement, au format du contrat.
 */
export function loginLockoutGuard(opts: LockoutGuardOptions): RequestHandler {
  const now = opts.now ?? (() => new Date());
  const field = opts.usernameField ?? "username";
  return async (req, res, next) => {
    const username = normalizeUsername(req.body?.[field]);
    if (!username) return next();
    const requestId = (req as { requestId?: string }).requestId;
    try {
      const state = await opts.store.get(username);
      if (isLocked(state, now())) {
        res.status(429).json({
          message: "Trop de tentatives de connexion. Réessayez plus tard.",
          code: "RATE_LIMITED",
          requestId,
          lockedUntil: state.lockedUntil!.toISOString(),
        });
        return;
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
