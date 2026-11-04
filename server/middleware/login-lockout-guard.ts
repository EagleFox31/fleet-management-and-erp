import type { RequestHandler } from "express";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { lockoutConfigFromEnv, normalizeUsername, type LockoutStore, type Reservation } from "../services/login-lockout-service";

const log = moduleLogger("login-lockout");

export interface LockoutGuardOptions {
  store: LockoutStore;
  now?: () => Date;
  /** Champ du corps portant l'identifiant (defaut "username"). */
  usernameField?: string;
  /** Prefixe de la cle du compteur : separe les espaces (mot de passe, PIN, changement de mot de passe). */
  keyPrefix?: string;
  /** Message du 429 (defaut : tentatives de connexion). */
  lockedMessage?: string;
  /**
   * Identifiant compte, a la place du champ du corps : pour une route sous session
   * (changement de mot de passe), la cle est le compte de session, jamais une saisie.
   */
  keyOf?: (req: Parameters<RequestHandler>[0]) => string | number | null | undefined;
}

/**
 * Avant le handler : la tentative est RESERVEE en base (+1 atomique). Verrou actif ou seuil depasse
 * -> 429 RATE_LIMITED + lockedUntil (meme corps pour un nom inconnu). Lire puis ecrire en deux temps
 * laissait N requetes simultanees verifier N secrets avant le premier echec enregistre.
 * Apres (res.on("finish")) :
 * - 401 -> echec confirme (verrou au seuil) ;
 * - 2xx -> remise a zero ;
 * - 400 ou 5xx -> tentative rendue : corps invalide ou panne, la reponse ne dit rien du secret
 *   (contrat : une panne n'est pas un echec de connexion). Seuls les 401 consomment le seuil, la borne
 *   « au plus maxAttempts reponses 401 » tient donc. La limite par IP (auth-ip-limit), elle, compte la 5xx ;
 * - tout autre statut, ou connexion coupee sans reponse -> la tentative reste comptee (le verrou expire seul).
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
    const cfg = lockoutConfigFromEnv();
    let reservation: Reservation;
    try {
      reservation = await opts.store.reserve(username, now(), cfg);
    } catch (err) {
      // Fermee sur panne : sans compteur, chaque essai verifierait un secret sans limite. Le 503 n'est
      // pas compte comme un echec (une panne n'est pas un echec de connexion).
      log.error({ err, requestId }, "reservation de la tentative impossible");
      return next(new AppError(503, "Connexion momentanément impossible, réessayez dans un instant.", { cause: err }));
    }
    if (!reservation.allowed) {
      const lockedUntil = reservation.state.lockedUntil ?? new Date(now().getTime() + cfg.lockMinutes * 60_000);
      return next(
        new AppError(429, opts.lockedMessage ?? "Trop de tentatives de connexion. Réessayez plus tard.", {
          code: "RATE_LIMITED",
          details: { lockedUntil: lockedUntil.toISOString() },
        }),
      );
    }
    res.once("finish", () => {
      let write: Promise<unknown> = Promise.resolve();
      if (res.statusCode === 401) write = opts.store.confirmFailure(username, now(), cfg);
      else if (res.statusCode >= 200 && res.statusCode < 300) write = opts.store.reset(username);
      else if (res.statusCode === 400 || res.statusCode >= 500) write = opts.store.release(username, now());
      write.catch((err) => log.error({ err, requestId }, "mise a jour du compteur d'echecs impossible"));
    });
    next();
  };
}
