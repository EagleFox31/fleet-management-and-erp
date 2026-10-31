import { get, set, del, clear, createStore, type UseStore } from "idb-keyval";
import type { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { clientLogger } from "@/lib/logger";
import { pendingServerLogout } from "@/lib/pending-logout";
import {
  createDbRegistry,
  createOfflineScope,
  getActiveOfflineUserId,
  setActiveOfflineUserId,
  subscribeActiveOfflineUser,
  isOfflineDbName,
  type OfflineKv,
} from "@/lib/offline-user-scope";

/**
 * Stockage hors ligne cloisonné par utilisateur.
 *
 * Une base IndexedDB par compte (`fleetos-offline-u<id>`), une liste blanche de
 * requêtes persistées et une file d'écritures par compte. La logique pure est dans
 * `offline-user-scope.ts` ; ce module la branche sur idb-keyval, le QueryClient
 * et la reconnexion réseau.
 *
 * Pour le lot hors ligne technicien : lire et écrire par `getActiveOfflineUserId()`
 * et `offlineScope` (jamais par une clé globale), purger par `purgeOfflineSession`.
 */

export interface OfflineAction {
  id: string;
  type: "fuel_entry" | "work_order_note" | "odometer_reading";
  endpoint: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  createdAt: number;
  label: string;
}

const DB_STORE_NAME = "kv";
const stores = new Map<string, UseStore>();

function storeOf(db: string): UseStore {
  let store = stores.get(db);
  if (!store) {
    store = createStore(db, DB_STORE_NAME);
    stores.set(db, store);
  }
  return store;
}

const dbRegistry = createDbRegistry(() => (typeof window === "undefined" ? null : window.localStorage));

const idbKv: OfflineKv = {
  get: <T>(db: string, key: string) => get<T>(key, storeOf(db)),
  set: (db, key, value) => {
    dbRegistry.add(db);
    return set(key, value, storeOf(db));
  },
  del: (db, key) => del(key, storeOf(db)),
  clearDb: (db) => clear(storeOf(db)),
  // Un magasin n'est jamais supprimé (deleteDatabase reste bloqué tant que la
  // connexion idb-keyval est ouverte) : il est vidé, ce qui suffit à la cloison.
  // Énumération : registre local (tous navigateurs) + bases connues du navigateur.
  async listDbs() {
    const names = new Set(dbRegistry.list());
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof factory.databases === "function") {
      try {
        for (const db of await factory.databases()) {
          if (isOfflineDbName(db.name)) names.add(db.name);
        }
      } catch (err) {
        clientLogger.warn("Énumération des bases IndexedDB impossible", { err });
      }
    }
    return Array.from(names);
  },
  delLegacy: (key) => del(key),
};

export const offlineScope = createOfflineScope(idbKv);

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
  void offlineScope.purgeOthers(userId).then((count) => {
    if (count > 0) {
      clientLogger.warn("Magasins hors ligne d'un autre compte vidés", { count });
    }
  });
}

/**
 * Déconnexion : plus aucun utilisateur actif, cache TanStack vidé, magasins
 * hors ligne (cache et file d'écritures) vidés. Ne lève jamais.
 */
export async function purgeOfflineSession(queryClient: QueryClient): Promise<void> {
  const active = getActiveOfflineUserId();
  setActiveOfflineUserId(null);
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à la déconnexion en échec", { err });
  }
  queryClient.clear();
  try {
    await offlineScope.purgeAll(active);
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
  try {
    await queryClient.cancelQueries();
  } catch (err) {
    clientLogger.warn("Annulation des requêtes à l'expiration de session en échec", { err });
  }
  queryClient.clear();
}

/**
 * Persiste dans IndexedDB les seules requêtes de la liste blanche, dans le
 * magasin de l'utilisateur actif.
 */
export async function persistQueryClientToIndexedDB(queryClient: QueryClient): Promise<void> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return;
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
    const queries = await offlineScope.loadCache(userId);
    // L'utilisateur a pu changer pendant la lecture : ne rien appliquer.
    if (getActiveOfflineUserId() !== userId) return 0;

    let restoredCount = 0;
    for (const item of queries) {
      if (queryClient.getQueryData(item.queryKey) !== undefined) continue;
      queryClient.setQueryData(item.queryKey, item.state.data, {
        updatedAt: typeof item.state.dataUpdatedAt === "number" ? item.state.dataUpdatedAt : undefined,
      });
      restoredCount++;
    }
    return restoredCount;
  } catch (err) {
    clientLogger.warn("Échec de restauration du cache IndexedDB", { err });
    return 0;
  }
}

/**
 * Ajoute une action additive à la file d'attente hors-ligne de l'utilisateur actif
 */
export async function enqueueOfflineAction(action: Omit<OfflineAction, "id" | "createdAt">): Promise<void> {
  const userId = getActiveOfflineUserId();
  if (userId === null) {
    clientLogger.error("Mise en file hors-ligne refusée : aucun utilisateur connecté", { label: action.label });
    toast({
      title: "Action non enregistrée",
      description: "Reconnectez-vous pour enregistrer cette action hors ligne.",
      variant: "destructive",
    });
    return;
  }

  try {
    // Compteur de purge relevé AVANT la lecture : une déconnexion survenue pendant
    // la lecture ou l'écriture annule l'écriture au lieu de ressusciter la file.
    const epoch = offlineScope.epochOf(userId);
    const queue = await offlineScope.readQueue<OfflineAction>(userId);
    const newAction: OfflineAction = {
      ...action,
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };

    queue.push(newAction);
    const saved = getActiveOfflineUserId() === userId && (await offlineScope.writeQueue(userId, queue, epoch));
    if (!saved) {
      clientLogger.warn("Mise en file hors-ligne annulée : la session a changé", { label: action.label });
      toast({
        title: "Action non enregistrée",
        description: "La session a changé pendant l'enregistrement. Reconnectez-vous et recommencez.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Mode Hors-Ligne",
      description: `${action.label} enregistré localement. Synchronisation dès retour du réseau.`,
    });
  } catch (err) {
    clientLogger.error("Échec de mise en file hors-ligne", { err, label: action.label });
  }
}

/**
 * Rejoue la file d'attente hors-ligne de l'utilisateur actif lors du retour de la connexion
 */
export async function processOfflineQueue(queryClient: QueryClient): Promise<{
  synced: number;
  failed: number;
}> {
  const userId = getActiveOfflineUserId();
  if (userId === null) return { synced: 0, failed: 0 };

  try {
    const queue = await offlineScope.readQueue<OfflineAction>(userId);
    if (queue.length === 0) return { synced: 0, failed: 0 };
    const startedAt = offlineScope.epochOf(userId);

    let synced = 0;
    let failed = 0;
    const remainingQueue: OfflineAction[] = [];

    for (const item of queue) {
      // Déconnexion ou changement de compte en cours de rejeu : on s'arrête.
      if (getActiveOfflineUserId() !== userId || offlineScope.epochOf(userId) !== startedAt) {
        return { synced, failed };
      }
      try {
        await apiRequest(item.method, item.endpoint, item.payload);
        synced++;
      } catch (err) {
        clientLogger.error("Échec rejeu action hors-ligne", { err, label: item.label });
        failed++;
        remainingQueue.push(item);
      }
    }

    // Aucune écriture si le magasin a été purgé pendant le rejeu.
    await offlineScope.writeQueue(userId, remainingQueue, startedAt);

    if (synced > 0) {
      toast({
        title: "Synchronisation réussie",
        description: `${synced} action(s) hors-ligne synchronisée(s) avec succès.`,
      });
      // Invalidation globale des requêtes pour rafraîchir les données
      queryClient.invalidateQueries();
    }

    if (failed > 0) {
      toast({
        title: "Attention",
        description: `${failed} action(s) n'ont pas pu être synchronisées et restent en attente.`,
        variant: "destructive",
      });
    }

    return { synced, failed };
  } catch (err) {
    clientLogger.error("Erreur de traitement de la file hors-ligne", { err });
    return { synced: 0, failed: 0 };
  }
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

  // Sauvegarde debounced lors des modifications de cache
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      void persistQueryClientToIndexedDB(queryClient);
    }, 2000);
  });

  // Rejeu automatique lors de la reconnexion réseau
  // Une déconnexion faite hors ligne est d'abord envoyée au serveur.
  const handleOnline = () => {
    void pendingServerLogout.flush().then((outcome) => {
      if (outcome !== "pending") void processOfflineQueue(queryClient);
    });
  };

  window.addEventListener("online", handleOnline);

  return () => {
    unsubscribeUser();
    unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
    window.removeEventListener("online", handleOnline);
  };
}
