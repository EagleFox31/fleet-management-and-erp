import { apiRequest, queryClient } from "@/lib/queryClient";
import { activateOfflineUser, purgeOfflineSession } from "@/lib/offline-storage";

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
 * le même appareil ne doit rien en relire.
 */
export async function logout(): Promise<void> {
  try {
    await apiRequest("POST", "/api/auth/logout");
  } finally {
    await purgeOfflineSession(queryClient);
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const { signal, clear } = createAuthTimeoutController(8_000);
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "include",
      signal,
    });
    
    if (response.status === 401) {
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
      console.warn("Auth check timeout: /api/auth/me");
      return null;
    }
    console.error("Error getting current user:", error);
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
