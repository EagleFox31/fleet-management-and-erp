import { get, set, del } from "idb-keyval";
import type { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

const QUERY_CACHE_KEY = "fleetos-query-cache-v1";
const OFFLINE_QUEUE_KEY = "fleetos-offline-queue-v1";

export interface OfflineAction {
  id: string;
  type: "fuel_entry" | "work_order_note" | "odometer_reading";
  endpoint: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
  createdAt: number;
  label: string;
}

/**
 * Persiste l'état du cache TanStack Query dans IndexedDB (asynchrone, sans plafond 5 Mo)
 */
export async function persistQueryClientToIndexedDB(queryClient: QueryClient): Promise<void> {
  try {
    const cache = queryClient.getQueryCache();
    const dehydratedQueries = cache.getAll().map((query) => ({
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      state: query.state,
    }));

    await set(QUERY_CACHE_KEY, {
      timestamp: Date.now(),
      queries: dehydratedQueries,
    });
  } catch (err) {
    console.warn("Échec de sauvegarde du cache dans IndexedDB:", err);
  }
}

/**
 * Restaure le cache TanStack Query depuis IndexedDB au démarrage
 */
export async function restoreQueryClientFromIndexedDB(queryClient: QueryClient): Promise<number> {
  try {
    const saved = await get<{ timestamp: number; queries: any[] }>(QUERY_CACHE_KEY);
    if (!saved || !Array.isArray(saved.queries)) return 0;

    // Cache valide pendant 7 jours
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - saved.timestamp > maxAge) {
      await del(QUERY_CACHE_KEY);
      return 0;
    }

    let restoredCount = 0;
    for (const item of saved.queries) {
      if (item.queryKey && item.state?.data !== undefined) {
        queryClient.setQueryData(item.queryKey, item.state.data);
        restoredCount++;
      }
    }

    return restoredCount;
  } catch (err) {
    console.warn("Échec de restauration du cache IndexedDB:", err);
    return 0;
  }
}

/**
 * Ajoute une action additive à la file d'attente hors-ligne
 */
export async function enqueueOfflineAction(action: Omit<OfflineAction, "id" | "createdAt">): Promise<void> {
  try {
    const queue = (await get<OfflineAction[]>(OFFLINE_QUEUE_KEY)) || [];
    const newAction: OfflineAction = {
      ...action,
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };

    queue.push(newAction);
    await set(OFFLINE_QUEUE_KEY, queue);

    toast({
      title: "Mode Hors-Ligne",
      description: `${action.label} enregistré localement. Synchronisation dès retour du réseau.`,
    });
  } catch (err) {
    console.error("Échec de mise en file hors-ligne:", err);
  }
}

/**
 * Rejoue la file d'attente hors-ligne lors du retour de la connexion
 */
export async function processOfflineQueue(queryClient: QueryClient): Promise<{
  synced: number;
  failed: number;
}> {
  try {
    const queue = (await get<OfflineAction[]>(OFFLINE_QUEUE_KEY)) || [];
    if (queue.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;
    const remainingQueue: OfflineAction[] = [];

    for (const item of queue) {
      try {
        await apiRequest(item.method, item.endpoint, item.payload);
        synced++;
      } catch (err) {
        console.error(`Échec rejeu action hors-ligne (${item.label}):`, err);
        failed++;
        remainingQueue.push(item);
      }
    }

    await set(OFFLINE_QUEUE_KEY, remainingQueue);

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
    console.error("Erreur de traitement de la file hors-ligne:", err);
    return { synced: 0, failed: 0 };
  }
}

/**
 * Initialise les écouteurs de persistance automatique et de reconnexion
 */
export function setupOfflinePersistence(queryClient: QueryClient): () => void {
  // Restauration initiale
  restoreQueryClientFromIndexedDB(queryClient);

  // Sauvegarde debounced lors des modifications de cache
  let timeoutId: NodeJS.Timeout | null = null;
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      persistQueryClientToIndexedDB(queryClient);
    }, 2000);
  });

  // Rejeu automatique lors de la reconnexion réseau
  const handleOnline = () => {
    processOfflineQueue(queryClient);
  };

  window.addEventListener("online", handleOnline);

  return () => {
    unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
    window.removeEventListener("online", handleOnline);
  };
}
