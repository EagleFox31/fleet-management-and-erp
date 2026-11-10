import type { SessionCheck } from "./session-check";
import type { PendingLogoutOutcome } from "./pending-logout";
import type { User } from "./auth";
import { clientLogger } from "@/lib/logger";

/**
 * Reprise de session au démarrage de l'application (seul chemin d'amorçage).
 *
 * Ordre imposé par la cloison entre comptes sur un appareil partagé :
 * 1. une déconnexion faite hors ligne part avant tout : sinon /api/auth/me
 *    rouvrirait, par le cookie encore valide, la session fermée par l'utilisateur ;
 * 2. une session restaurée désigne le magasin hors ligne de son compte ;
 * 3. un 401 expire la session du compte actif au départ de la requête (sa file
 *    d'écritures est gardée pour sa prochaine connexion).
 * Une déconnexion trouvée en attente au démarrage (onglet fermé pendant le
 * POST /logout) refait d'abord la purge locale : elle a pu ne pas aboutir.
 *
 * Sans réseau au démarrage (et seulement alors : un 401, un 403 ou une 5xx ne rouvrent rien), le
 * marqueur `offline-resume` peut rouvrir la lecture hors ligne du chauffeur (`restoreOffline`).
 * Une réponse 401 l'efface ; une session confirmée le réécrit avec le compte renvoyé.
 *
 * Les dépendances sont injectées pour tester la composition sans navigateur.
 */
export interface SessionResumeDeps {
  flushPendingLogout(): Promise<PendingLogoutOutcome>;
  checkSession(): Promise<SessionCheck>;
  getActiveUserId(): number | null;
  activateUser(userId: number): void;
  expireUser(userId: number): Promise<void>;
  /** Purge locale de la déconnexion (cache TanStack, magasins hors ligne, état navigateur). `false` : purge incomplète. */
  purgeLocal(): Promise<boolean | void>;
  /** Remet le repère de déconnexion en attente quand la purge locale n'a pas abouti. */
  markPendingLogout?(): void;
  /** Écrit le marqueur de reprise hors ligne après un /me réussi (ne lève jamais). */
  recordOnline(user: User): Promise<void>;
  /** Rouvre la lecture hors ligne depuis le marqueur ; vrai si un compte a été restauré. */
  restoreOffline(): Promise<boolean>;
  /** Efface le marqueur de reprise (session refusée par le serveur). */
  clearResume(): Promise<void>;
}

/** La reprise hors ligne ne doit jamais empêcher le démarrage : l'échec est journalisé sans contenu. */
async function settle(op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
  } catch (err) {
    clientLogger.warn("Reprise hors ligne en échec", { err });
  }
}

export function createSessionResume(deps: SessionResumeDeps): () => Promise<SessionCheck> {
  return async function resumeSession(): Promise<SessionCheck> {
    const pending = await deps.flushPendingLogout();
    if (pending !== "none") {
      const purged = await deps.purgeLocal();
      if (purged === false) {
        // Purge incomplète : le repère revient, on ne rouvre rien et on retentera au prochain démarrage.
        deps.markPendingLogout?.();
        return { status: "anonymous" };
      }
    }
    if (pending === "pending") {
      // La déconnexion n'a pas pu partir : l'utilisateur reste déconnecté localement.
      return { status: "anonymous" };
    }

    // Compte actif au départ : un 401 tardif ne doit pas retirer un compte connecté entre-temps.
    const activeAtStart = deps.getActiveUserId();
    const result = await deps.checkSession();

    if (result.status === "authenticated") {
      const id = result.user?.id;
      if (Number.isInteger(id) && id > 0) {
        deps.activateUser(id);
        await settle(() => deps.recordOnline(result.user));
      }
    } else if (result.status === "anonymous") {
      if (activeAtStart !== null) await deps.expireUser(activeAtStart);
      await settle(deps.clearResume);
    } else if (result.httpStatus === undefined && activeAtStart === null) {
      // Réseau injoignable, aucun compte en mémoire : lecture seule depuis le marqueur, si valide.
      await settle(deps.restoreOffline);
    }
    return result;
  };
}

export interface LogoutDeps {
  markPending(): void;
  clearPending(): void;
  /** `false` : la purge locale n'a pas abouti, le repère de déconnexion reste. */
  purgeLocal(): Promise<boolean | void>;
  postLogout(): Promise<void>;
}

/**
 * Déconnexion : repère posé, purge locale AVANT l'appel serveur (un onglet fermé
 * pendant le POST ne laisse aucune donnée lue sur l'appareil), puis POST /logout.
 * Si le serveur ne répond pas, le repère reste : la déconnexion part au démarrage
 * suivant ou au retour du réseau. L'erreur réseau est relancée à l'appelant.
 */
export function createLogout(deps: LogoutDeps): () => Promise<void> {
  return async function logout(): Promise<void> {
    deps.markPending();
    const purged = await deps.purgeLocal();
    await deps.postLogout();
    // Repère gardé tant que la purge locale n'a pas abouti : le prochain démarrage la reprend.
    if (purged !== false) deps.clearPending();
  };
}
