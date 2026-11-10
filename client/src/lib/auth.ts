import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  activateOfflineUser,
  expireOfflineSession,
  purgeOfflineSession,
  recordOfflineResume,
  resumeOfflineRead,
} from "@/lib/offline-storage";
import { offlineResume } from "@/lib/offline-kv";
import { getActiveOfflineUserId } from "@/lib/offline-user-scope";
import { pendingServerLogout } from "@/lib/pending-logout";
import { checkSession } from "@/lib/session-check";
import { createLogout, createSessionResume } from "@/lib/session-resume";
import { purgeBrowserUserState } from "@/lib/form-draft-storage";

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegistrationData {
  username: string;
  password: string;
  email: string;
  name: string;
  role: string;
}

export interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  /** Droit de sortie de stock en dérogation (chef d'atelier), retirable par l'admin. */
  canIssueStock?: boolean;
}

const AUTH_TIMEOUT_MS = 12_000;

function createAuthTimeoutController(timeoutMs: number = AUTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

/** Désigne le magasin hors ligne de cet utilisateur (cloison par compte). */
function rememberOfflineUser(user: User): void {
  if (user && Number.isInteger(user.id) && user.id > 0) {
    activateOfflineUser(queryClient, user.id);
  }
}

export async function login(credentials: LoginCredentials): Promise<User> {
  const { signal, clear } = createAuthTimeoutController();
  try {
    const response = await apiRequest("/api/auth/login", {
      method: "POST",
      body: credentials,
      signal,
    });
    const user: User = await response.json();
    // Nouvelle session : l'ancienne, restée à fermer côté serveur, est remplacée.
    pendingServerLogout.clear();
    rememberOfflineUser(user);
    await recordOfflineResume(queryClient, user);
    return user;
  } finally {
    clear();
  }
}

export async function register(data: RegistrationData): Promise<User> {
  const response = await apiRequest("POST", "/api/auth/register", data);
  return await response.json();
}

/** Purge locale d'une déconnexion : cache TanStack, magasins hors ligne, état navigateur. Ne lève pas. */
async function purgeLocalSession(): Promise<boolean> {
  const complete = await purgeOfflineSession(queryClient);
  purgeBrowserUserState();
  return complete;
}

/**
 * Déconnexion. Le stockage hors ligne et le cache TanStack de ce compte sont purgés
 * avant l'appel serveur : le compte suivant sur le même appareil ne doit rien en
 * relire, même si l'onglet se ferme pendant l'appel. Si le serveur n'a pas pu être
 * joint, un repère local garde la déconnexion à envoyer (démarrage suivant ou retour
 * du réseau), sinon le cookie de session reconnecterait ce compte. Voir `session-resume.ts`.
 */
export const logout = createLogout({
  markPending: () => pendingServerLogout.mark(),
  clearPending: () => pendingServerLogout.clear(),
  purgeLocal: purgeLocalSession,
  postLogout: async () => {
    await apiRequest("POST", "/api/auth/logout");
  },
});

/**
 * Amorçage de session : déconnexion différée envoyée d'abord, puis /api/auth/me,
 * puis activation ou expiration du magasin hors ligne. Voir `session-resume.ts`.
 */
export const resumeSession = createSessionResume({
  flushPendingLogout: () => pendingServerLogout.flush(),
  checkSession: () => checkSession(),
  getActiveUserId: getActiveOfflineUserId,
  activateUser: (userId) => activateOfflineUser(queryClient, userId),
  expireUser: (userId) => expireOfflineSession(queryClient, userId),
  recordOnline: (user) => recordOfflineResume(queryClient, user),
  restoreOffline: () => resumeOfflineRead(queryClient),
  clearResume: () => offlineResume.clear(),
  purgeLocal: purgeLocalSession,
  markPendingLogout: () => pendingServerLogout.mark(),
});

/**
 * Fin de la lecture hors ligne (échéance atteinte pendant l'usage) : plus d'utilisateur actif, cache TanStack
 * vidé, copie de lecture et marqueur supprimés ; la file d'envois est gardée pour la prochaine connexion.
 */
export function expireOfflineGrant(grant: { userId: number }): Promise<void> {
  return expireOfflineSession(queryClient, grant.userId);
}

export function isAdmin(user: User | null): boolean {
  return !!user && user.role === "admin";
}

export function isWorkshopManager(user: User | null): boolean {
  return !!user && (user.role === "admin" || user.role === "workshop_manager");
}

/** Montage pneu depuis stock — aligné sur `isWorkshopManager` côté API. */
export function canMountTiresFromStock(user: User | null): boolean {
  return isWorkshopManager(user);
}

/** Création / modification fiche véhicule — aligné sur `isWorkshopManager` côté API. */
export function canManageFleetVehicles(user: User | null): boolean {
  return isWorkshopManager(user);
}

export function isTechnician(user: User | null): boolean {
  return !!user && (user.role === "admin" || user.role === "workshop_manager" || user.role === "technician");
}

/** Inventaire pièces atelier — aligné sur `isInventoryManager` côté API (hors logistique). */
export const PARTS_INVENTORY_ROLES = ["admin", "workshop_manager", "warehouse", "secretary"] as const;

export function canAccessPartsInventory(user: User | null): boolean {
  return !!user && (PARTS_INVENTORY_ROLES as readonly string[]).includes(user.role);
}
