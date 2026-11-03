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
 *
 * Les dépendances sont injectées pour tester la composition sans navigateur.
 */
export interface SessionResumeDeps {
  flushPendingLogout(): Promise<PendingLogoutOutcome>;
  checkSession(): Promise<SessionCheck>;
  getActiveUserId(): number | null;
  activateUser(userId: number): void;
  expireUser(userId: number): Promise<void>;
}

export function createSessionResume(deps: SessionResumeDeps): () => Promise<SessionCheck> {
  return async function resumeSession(): Promise<SessionCheck> {
    if ((await deps.flushPendingLogout()) === "pending") {
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
