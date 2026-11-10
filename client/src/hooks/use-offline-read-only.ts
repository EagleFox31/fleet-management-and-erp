import { useAuth } from "@/hooks/useAuth";
import { isOfflineReadOnly } from "@/lib/offline-read-only";

/**
 * Vrai en consultation seule après une reprise hors ligne (voir `lib/offline-read-only.ts`). Chaque bouton
 * ou action d'écriture d'un écran servi dans le shell restreint DOIT lire ce hook : il n'existe aucun autre
 * moyen de savoir qu'on est en consultation seule.
 */
export function useOfflineReadOnly(): boolean {
  const { user, offlineGrant } = useAuth();
  return isOfflineReadOnly({ user, offlineGrant });
}
