import { apiRequest, queryClient } from "@/lib/queryClient";
import { activateOfflineUser, expireOfflineSession, purgeOfflineSession } from "@/lib/offline-storage";
import { getActiveOfflineUserId } from "@/lib/offline-user-scope";
import { clientLogger } from "@/lib/logger";
import { pendingServerLogout } from "@/lib/pending-logout";
import { purgeBrowserUserState } from "@/lib/form-draft-storage";

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
  /** Preuve ALTCHA (champ `captcha` du contrat), seulement quand le défi est affiché. */
  captcha?: string;
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
    return user;
  } finally {
    clear();
  }
}

export async function register(data: RegistrationData): Promise<User> {
  const response = await apiRequest("POST", "/api/auth/register", data);
  return await response.json();
}

/**
 * Déconnexion. Que le serveur réponde ou non (réseau coupé), le stockage hors
 * ligne et le cache TanStack de ce compte sont purgés : le compte suivant sur
 * le même appareil ne doit rien en relire. Si le serveur n'a pas pu être joint, un
 * repère local garde la déconnexion à envoyer (démarrage suivant ou retour du
 * réseau), sinon le cookie de session reconnecterait ce compte.
 */
export async function logout(): Promise<void> {
  pendingServerLogout.mark();
  try {
    await apiRequest("POST", "/api/auth/logout");
    pendingServerLogout.clear();
  } finally {
    await purgeOfflineSession(queryClient);
    purgeBrowserUserState();
  }
}

export async function getCurrentUser(): Promise<User | null> {
  // Une déconnexion faite hors ligne part avant tout : sinon /api/auth/me
  // rouvrirait la session que l'utilisateur a fermée.
  if ((await pendingServerLogout.flush()) === "pending") {
    return null;
  }

  // Compte actif au départ de la requête : une réponse 401 tardive ne doit pas
  // retirer un compte qui s'est connecté entre-temps.
  const activeAtStart = getActiveOfflineUserId();
  const { signal, clear } = createAuthTimeoutController(8_000);
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      signal,
    });

    if (response.status === 401) {
      // Session expirée : le cache TanStack et l'utilisateur actif sont vidés,
      // la file d'écritures de ce compte reste pour sa prochaine connexion.
      if (activeAtStart !== null) {
        await expireOfflineSession(queryClient, activeAtStart);
      }
      return null;
    }
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    
    const user: User = await response.json();
    rememberOfflineUser(user);
    return user;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      clientLogger.warn("Auth check timeout: /api/auth/me");
      return null;
    }
    clientLogger.error("Error getting current user", { err: error });
    return null;
  } finally {
    clear();
  }
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
