import type { User } from "./auth";
import { nextSessionRetryDelay, type OfflineGrantInfo, type SessionCheck } from "./session-check";

/**
 * Amorçage de la session côté interface, sans React : boucle de vérification (`resumeSession`, backoff),
 * reprise hors ligne et échéance de la lecture. `useAuth` ne fait que recopier l'état dans ses `useState`.
 *
 * Reprise hors ligne : quand `/api/auth/me` est injoignable et que la lecture hors ligne s'est rouverte
 * (`SessionCheck.resumed`), l'état porte `offlineGrant`, `isLoading` passe à faux et `user` RESTE `null` :
 * aucun faux utilisateur, aucun rôle reconstruit depuis le stockage local. La boucle continue en arrière-plan.
 * - `/me` répond : `user` renseigné, `offlineGrant` effacé ;
 * - 401 : `resumeSession` a déjà purgé ; `offlineGrant` effacé, écran de connexion ;
 * - échéance atteinte pendant l'usage : retour au voile `sessionUnreachable` ET arrêt des lectures hors
 *   ligne (`expireOfflineGrant` vide le cache TanStack restauré et la copie de lecture).
 */
export interface AuthBootstrapState {
  user: User | null;
  /** Vrai tant que ni un utilisateur confirmé, ni une reprise hors ligne, ni un 401 n'a tranché. */
  isLoading: boolean;
  /** Vrai quand `/me` n'a pas répondu et qu'aucune lecture hors ligne n'est ouverte : voile d'attente. */
  sessionUnreachable: boolean;
  offlineGrant: OfflineGrantInfo | null;
}

export interface AuthBootstrapDeps {
  resumeSession(): Promise<SessionCheck>;
  /** Coupe toute lecture hors ligne du compte (cache TanStack, copie de lecture, marqueur). Ne doit pas lever. */
  expireOfflineGrant(grant: OfflineGrantInfo): Promise<void>;
  now(): number;
  /** Vrai quand l'amorçage a été remplacé (connexion, déconnexion, démontage) : plus rien ne doit être publié. */
  isStale(): boolean;
  onState(state: AuthBootstrapState): void;
  onUnreachable?(attempt: number): void;
  onExpired?(grant: OfflineGrantInfo): void;
}

export const INITIAL_AUTH_STATE: AuthBootstrapState = {
  user: null,
  isLoading: true,
  sessionUnreachable: false,
  offlineGrant: null,
};

export function createAuthBootstrap(deps: AuthBootstrapDeps) {
  let state: AuthBootstrapState = { ...INITIAL_AUTH_STATE };
  let wake: (() => void) | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (patch: Partial<AuthBootstrapState>): void => {
    state = { ...state, ...patch };
    if (!deps.isStale()) deps.onState(state);
  };

  const clearExpiryTimer = (): void => {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  };

  /** Échéance atteinte : l'interface repasse au voile d'abord, la lecture est coupée ensuite. */
  async function expire(grant: OfflineGrantInfo): Promise<void> {
    clearExpiryTimer();
    if (deps.isStale() || state.offlineGrant?.userId !== grant.userId) return;
    publish({ offlineGrant: null, isLoading: true, sessionUnreachable: true });
    deps.onExpired?.(grant);
    try {
      await deps.expireOfflineGrant(grant);
    } catch {
      /* la coupure est déjà faite côté interface ; l'échec est journalisé par l'appelant */
    }
  }

  function adopt(grant: OfflineGrantInfo): void {
    clearExpiryTimer();
    publish({ offlineGrant: grant, isLoading: false, sessionUnreachable: false });
    // setTimeout plafonne à ~24 jours ; la reprise dure 72 h.
    expiryTimer = setTimeout(() => void expire(grant), Math.max(0, grant.expiresAt - deps.now()));
  }

  async function run(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const result = await deps.resumeSession();
      if (deps.isStale()) return;
      if (result.status !== "unreachable") {
        clearExpiryTimer();
        publish({
          user: result.status === "authenticated" ? result.user : null,
          sessionUnreachable: false,
          isLoading: false,
          offlineGrant: null,
        });
        return;
      }
      deps.onUnreachable?.(attempt);
      if (result.resumed) {
        adopt(result.resumed);
      } else if (state.offlineGrant && deps.now() >= state.offlineGrant.expiresAt) {
        // Appareil endormi : le minuteur n'a pas tourné à l'heure, l'échéance est vérifiée à chaque tour.
        await expire(state.offlineGrant);
      } else if (!state.offlineGrant) {
        publish({ sessionUnreachable: true });
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, nextSessionRetryDelay(attempt));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
      if (deps.isStale()) return;
    }
  }

  return {
    start: run,
    /** Relance immédiate de la vérification (bouton « Réessayer maintenant », connexion, déconnexion). */
    retryNow(): void {
      wake?.();
    },
    /** Arrête le minuteur d'échéance (démontage, connexion, déconnexion). */
    dispose(): void {
      clearExpiryTimer();
    },
  };
}
