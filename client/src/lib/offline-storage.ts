import type { QueryClient } from "@tanstack/react-query";
import { clientLogger } from "@/lib/logger";
import { applyRestoredQueries } from "@/lib/offline-restore";
import { pendingServerLogout } from "@/lib/pending-logout";
import {
  DRIVER_READ_PROFILE,
  getActiveOfflineUserId,
  setActiveOfflineUserId,
  subscribeActiveOfflineUser,
} from "@/lib/offline-user-scope";
import { offlineScope } from "@/lib/offline-kv";
import { sessionChannel } from "@/lib/offline-session-channel";
import {
  announceKeptSends,
  cancelScheduledReplay,
  enqueueOfflineWrite,
  isOfflineFlagEnabled,
  replayOnReconnect,
  startOfflineQueueRuntime,
} from "@/lib/offline-queue";
import { FEATURE_FLAGS_PATH, isFeatureKey } from "@shared/feature-flags";
import { releaseReplayGate } from "@/lib/offline-replay-gate";
import { OFFLINE_QUEUED_MESSAGE } from "@/lib/offline-queue-core";
import { toast } from "@/hooks/use-toast";

/**
 * Stockage hors ligne cloisonné par utilisateur.
 *
 * Une base IndexedDB par compte (`fleetos-offline-u<id>`), une liste blanche de
 * requêtes persistées et une file d'écritures par compte. La logique pure est dans
 * `offline-user-scope.ts` ; l'adaptateur idb-keyval dans `offline-kv.ts` ; la file
 * d'écritures (v2) dans `offline-queue-core.ts` / `offline-queue.ts`. Ce module
 * branche le tout sur le QueryClient et la reconnexion réseau.
 *
 * Pour le lot hors ligne technicien : lire et écrire par `getActiveOfflineUserId()`
 * et `offlineScope` (jamais par une clé globale), purger par `purgeOfflineSession`,
 * mettre en file par `enqueueOfflineWrite` (registre `offline-action-registry.ts`).
 */

export { offlineScope };

export interface OfflineAction {
  type: "fuel_entry" | "work_order_note" | "odometer_reading";
  endpoint: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  label: string;
  missionId?: number;
  idempotencyKey?: string;
}

/**
 * Appelé à chaque connexion et à chaque restauration de session. Si l'utilisateur
 * change, le cache TanStack du précédent est vidé, ses copies hors ligne et
 * l'ancien format global (propriétaire inconnu) sont détruits.
 */
export function activateOfflineUser(queryClient: QueryClient, userId: number): void {
  if (getActiveOfflineUserId() === userId) return;
  queryClient.clear();
  setActiveOfflineUserId(userId);
  void offlineScope.purgeLegacy();
  cancelScheduledReplay();
  // Changement de compte : les copies et les envois en attente de l'autre compte sont détruits (S1).
  void offlineScope.purgeOthers(userId, { dropQueues: true }).then((count) => {
    if (count > 0) {
      clientLogger.warn("Données hors ligne d'un autre compte supprimées", { count });
    }
  });
}

/**
 * Déconnexion : plus aucun utilisateur actif, cache TanStack vidé, magasins
 * hors ligne (cache et file d'écritures) vidés. Ne lève jamais.
 */
export async function purgeOfflineSession(
  queryClient: QueryClient,
  options: { broadcast?: boolean } = {},
): Promise<void> {
  const active = getActiveOfflineUserId();
  setActiveOfflineUserId(null);
  cancelScheduledReplay();
  // Les autres onglets de l'appareil se purgent aussi (la file est partagée entre onglets).
  if (options.broadcast !== false) sessionChannel.post({ type: "logout" });
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à la déconnexion en échec", { err });
  }
  queryClient.clear();
  try {
    await offlineScope.purgeAll(active, { dropOtherQueues: true });
  } catch (err) {
    clientLogger.error("Purge du stockage hors ligne en échec", { err });
  }
}

/**
 * Session expirée côté serveur (401) alors que `userId` était actif : plus aucun
 * utilisateur actif et cache TanStack vidé, mais les magasins hors ligne de ce
 * compte, file d'écritures comprise, sont conservés pour sa prochaine connexion.
 * Sans effet si un autre compte (ou aucun) est devenu actif entre-temps.
 */
export async function expireOfflineSession(queryClient: QueryClient, userId: number): Promise<void> {
  if (getActiveOfflineUserId() !== userId) return;
  setActiveOfflineUserId(null);
  cancelScheduledReplay();
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à l'expiration de session en échec", { err });
  }
  queryClient.clear();
  // Session expirée : plus de lecture hors ligne pour ce compte (la file d'envois est gardée).
  await offlineScope.dropUserReadCache(userId);
  // Envois gardés : l'utilisateur est prévenu qu'il doit se reconnecter pour qu'ils partent.
  void announceKeptSends(userId);
}

/** Lecteur de drapeaux des profils de lecture hors ligne (un drapeau inconnu est éteint). */
const readFlag = (flag: string): boolean => isFeatureKey(flag) && isOfflineFlagEnabled(flag);

/**
 * Persiste dans IndexedDB les seules requêtes de la liste blanche, dans le
 * magasin de l'utilisateur actif.
 */
export async function persistQueryClientToIndexedDB(queryClient: QueryClient): Promise<void> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return;
  const flagsKnown = queryClient.getQueryData([FEATURE_FLAGS_PATH]) !== undefined;
  try {
    await offlineScope.saveCache(
      userId,
      queryClient.getQueryCache().getAll().map((query) => ({
        queryKey: query.queryKey,
        state: {
          data: query.state.data,
          status: query.state.status,
          dataUpdatedAt: query.state.dataUpdatedAt,
        },
      })),
      Date.now(),
      readFlag,
      { dropIfEmpty: flagsKnown && !DRIVER_READ_PROFILE.flags.every(readFlag) },
    );
  } catch (err) {
    clientLogger.warn("Échec de sauvegarde du cache dans IndexedDB", { err });
  }
}

/**
 * Restaure au démarrage le cache de l'utilisateur actif, sans écraser une donnée
 * déjà plus récente en mémoire.
 */
export async function restoreQueryClientFromIndexedDB(queryClient: QueryClient): Promise<number> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return 0;
  try {
    const queries = await offlineScope.loadCache(userId, Date.now(), readFlag);
    // L'utilisateur a pu changer pendant la lecture : ne rien appliquer.
    if (getActiveOfflineUserId() !== userId) return 0;

    return applyRestoredQueries(queryClient, queries);
  } catch (err) {
    clientLogger.warn("Échec de restauration du cache IndexedDB", { err });
    return 0;
  }
}

/**
 * Ancienne API de mise en file, conservée pour les appelants existants : elle délègue
 * à la file v2 (clé d'idempotence stable, rejeu FIFO). Sans les drapeaux, la mise en
 * file est refusée et l'appelant est prévenu.
 */
export async function enqueueOfflineAction(action: OfflineAction): Promise<void> {
  const result = await enqueueOfflineWrite({
    type: action.type,
    payload: action.payload,
    endpoint: action.endpoint,
    method: action.method,
    missionId: action.missionId,
    label: action.label,
    idempotencyKey: action.idempotencyKey,
  });
  if (result.queued) {
    toast({ title: "Mode Hors-Ligne", description: OFFLINE_QUEUED_MESSAGE });
    return;
  }
  clientLogger.warn("Mise en file hors-ligne refusée", { label: action.label, reason: result.reason });
  toast({
    title: "Action non enregistrée",
    description:
      result.reason === "disabled"
        ? "L'enregistrement hors ligne n'est pas activé. Réessayez avec du réseau."
        : "Reconnectez-vous pour enregistrer cette action hors ligne.",
    variant: "destructive",
  });
}

/**
 * Initialise les écouteurs de persistance automatique et de reconnexion
 */
export function setupOfflinePersistence(queryClient: QueryClient): () => void {
  // Restauration initiale (utilisateur déjà connu) puis à chaque connexion
  void restoreQueryClientFromIndexedDB(queryClient);
  const unsubscribeUser = subscribeActiveOfflineUser((userId) => {
    if (userId !== null) void restoreQueryClientFromIndexedDB(queryClient);
  });
  const stopQueueRuntime = startOfflineQueueRuntime();

  // Un autre onglet s'est déconnecté : cet onglet se purge aussi, sans réémettre.
  const unsubscribeChannel = sessionChannel.subscribe((message) => {
    if (message.type === "logout") void purgeOfflineSession(queryClient, { broadcast: false });
  });

  // Sauvegarde debounced lors des modifications de cache
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      void persistQueryClientToIndexedDB(queryClient);
    }, 2000);
  });

  // Retour du réseau : déconnexion différée d'abord, puis rejeu de la file. La barrière
  // du resync temps réel est levée dans tous les cas (voir offline-replay-gate.ts).
  const handleOnline = () => {
    void pendingServerLogout
      .flush()
      .then((outcome) => (outcome !== "pending" ? replayOnReconnect() : undefined))
      .finally(() => releaseReplayGate());
  };

  window.addEventListener("online", handleOnline);

  return () => {
    unsubscribeUser();
    unsubscribeChannel();
    stopQueueRuntime();
    unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
    window.removeEventListener("online", handleOnline);
  };
}
