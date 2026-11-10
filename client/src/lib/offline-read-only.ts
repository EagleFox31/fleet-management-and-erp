import type { OfflineGrantInfo } from "@/lib/session-check";

/**
 * Consultation seule : source UNIQUE de la règle « lecture hors ligne sans utilisateur confirmé ».
 * Tout bouton ou action d'écriture d'un écran servi dans cet état la lit par `useOfflineReadOnly()`
 * (`hooks/use-offline-read-only.ts`). `user` est `null` tant que `/api/auth/me` n'a pas répondu : rien
 * ne s'écrit au nom d'un compte que le serveur n'a pas confirmé.
 */
export function isOfflineReadOnly(auth: {
  user: unknown | null | undefined;
  offlineGrant?: OfflineGrantInfo | null;
}): boolean {
  return !auth.user && !!auth.offlineGrant;
}

/**
 * Accueil de chaque profil de lecture hors ligne (`OfflineReadProfile.id`, jamais un rôle). Un profil absent
 * de la table n'a pas d'accueil restreint : l'application reste sur le voile. Les composants correspondants
 * vivent dans `components/offline/offline-shell.tsx`.
 */
export const OFFLINE_HOME_PATH_BY_PROFILE: Readonly<Record<string, string>> = {
  driver: "/",
};

export function offlineHomePathFor(profile: string): string | null {
  return Object.prototype.hasOwnProperty.call(OFFLINE_HOME_PATH_BY_PROFILE, profile)
    ? OFFLINE_HOME_PATH_BY_PROFILE[profile]
    : null;
}
