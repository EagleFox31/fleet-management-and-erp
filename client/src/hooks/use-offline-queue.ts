import { useSyncExternalStore } from "react";
import {
  getOfflineQueueSnapshot,
  subscribeOfflineQueue,
  type OfflineQueueSnapshot,
} from "@/lib/offline-queue";

/** État observable de la file d'écritures hors ligne du compte actif (sans les charges utiles). */
export function useOfflineQueue(): OfflineQueueSnapshot {
  return useSyncExternalStore(subscribeOfflineQueue, getOfflineQueueSnapshot, getOfflineQueueSnapshot);
}
