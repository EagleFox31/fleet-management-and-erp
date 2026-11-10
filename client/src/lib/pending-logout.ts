import { apiRequest } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { clientLogger } from "@/lib/logger";

/**
 * Déconnexion serveur en attente.
 *
 * Une déconnexion faite hors ligne vide l'appareil mais n'atteint pas le serveur :
 * le cookie de session (30 jours) reste valide et reconnecterait le compte au
 * retour du réseau. La déconnexion laisse donc un repère local, sans donnée
 * utilisateur, que le démarrage de l'application et le retour du réseau envoient
 * au serveur avant tout appel à `/api/auth/me`.
 */

export const PENDING_LOGOUT_KEY = "fleetos-pending-server-logout";

export type PendingLogoutOutcome = "none" | "sent" | "pending";

export interface PendingLogoutFlushOptions {
  /**
   * Purge locale à refaire APRÈS l'envoi serveur et AVANT d'effacer le repère. `false` (purge toujours
   * incomplète) : le repère reste et l'issue est `pending`, pour que le prochain démarrage ou retour du
   * réseau retente. Le repère n'est effacé qu'une fois l'appareil réellement vidé.
   */
  beforeClear?: () => Promise<boolean | void>;
}

export interface PendingLogoutDeps {
  /** Stockage local du navigateur, null s'il est indisponible. */
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  /** Envoie la déconnexion au serveur ; rejette si elle n'a pas abouti. */
  sendLogout: () => Promise<void>;
  now?: () => number;
}

export function createPendingLogout(deps: PendingLogoutDeps) {
  let inFlight: Promise<PendingLogoutOutcome> | null = null;

  function safeStorage() {
    try {
      return deps.storage();
    } catch {
      return null;
    }
  }

  function isPending(): boolean {
    try {
      return safeStorage()?.getItem(PENDING_LOGOUT_KEY) != null;
    } catch {
      return false;
    }
  }

  function mark(): void {
    try {
      safeStorage()?.setItem(PENDING_LOGOUT_KEY, String((deps.now ?? Date.now)()));
    } catch (err) {
      clientLogger.warn("Repère de déconnexion en attente non enregistré", { err });
    }
  }

  function clear(): void {
    try {
      safeStorage()?.removeItem(PENDING_LOGOUT_KEY);
    } catch (err) {
      clientLogger.warn("Repère de déconnexion en attente non effacé", { err });
    }
  }

  /** Purge locale demandée par l'appelant ; faux = le repère doit rester. Une levée vaut échec. */
  async function purgedBeforeClear(options?: PendingLogoutFlushOptions): Promise<boolean> {
    if (!options?.beforeClear) return true;
    try {
      return (await options.beforeClear()) !== false;
    } catch (err) {
      clientLogger.warn("Purge locale de la déconnexion en échec", { err });
      return false;
    }
  }

  async function run(options?: PendingLogoutFlushOptions): Promise<PendingLogoutOutcome> {
    if (!isPending()) return "none";
    try {
      await deps.sendLogout();
      if (!(await purgedBeforeClear(options))) return "pending";
      clear();
      return "sent";
    } catch (err) {
      // 401 : le serveur ne connaît déjà plus la session, rien à fermer.
      if (isApiError(err, 401)) {
        if (!(await purgedBeforeClear(options))) return "pending";
        clear();
        return "sent";
      }
      // Réseau coupé ou erreur serveur : le repère reste, nouvel essai plus tard.
      clientLogger.warn("Déconnexion serveur toujours en attente", { err });
      return "pending";
    }
  }

  return {
    isPending,
    /** À appeler quand la déconnexion serveur n'a pas abouti. */
    mark,
    /** À appeler quand une nouvelle session s'ouvre : l'ancienne n'a plus à être fermée. */
    clear,
    /** Envoie la déconnexion en attente (un seul envoi à la fois). */
    flush(options?: PendingLogoutFlushOptions): Promise<PendingLogoutOutcome> {
      if (!inFlight) {
        inFlight = run(options).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}

export const pendingServerLogout = createPendingLogout({
  storage: () => (typeof window === "undefined" ? null : window.localStorage),
  sendLogout: async () => {
    await apiRequest("POST", "/api/auth/logout");
  },
});
