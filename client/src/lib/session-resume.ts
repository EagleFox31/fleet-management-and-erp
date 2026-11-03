import type { SessionCheck } from "./session-check";
import type { PendingLogoutOutcome } from "./pending-logout";

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
 * Les dépendances sont injectées pour tester la composition sans navigateur.
 */
export interface SessionResumeDeps {
  flushPendingLogout(): Promise<PendingLogoutOutcome>;
  checkSession(): Promise<SessionCheck>;
  getActiveUserId(): number | null;
  activateUser(userId: number): void;
  expireUser(userId: number): Promise<void>;
  /** Purge locale de la déconnexion (cache TanStack, magasins hors ligne, état navigateur). */
  purgeLocal(): Promise<void>;
}

export function createSessionResume(deps: SessionResumeDeps): () => Promise<SessionCheck> {
  return async function resumeSession(): Promise<SessionCheck> {
    const pending = await deps.flushPendingLogout();
    if (pending !== "none") await deps.purgeLocal();
    if (pending === "pending") {
      // La déconnexion n'a pas pu partir : l'utilisateur reste déconnecté localement.
      return { status: "anonymous" };
    }

    // Compte actif au départ : un 401 tardif ne doit pas retirer un compte connecté entre-temps.
    const activeAtStart = deps.getActiveUserId();
    const result = await deps.checkSession();

    if (result.status === "authenticated") {
      const id = result.user?.id;
      if (Number.isInteger(id) && id > 0) deps.activateUser(id);
    } else if (result.status === "anonymous" && activeAtStart !== null) {
      await deps.expireUser(activeAtStart);
    }
    return result;
  };
}

export interface LogoutDeps {
  markPending(): void;
  clearPending(): void;
  purgeLocal(): Promise<void>;
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
    await deps.purgeLocal();
    await deps.postLogout();
    deps.clearPending();
  };
}
