import { get, set, del, clear, createStore, type UseStore } from "idb-keyval";
import { clientLogger } from "@/lib/logger";
import {
  createDbRegistry,
  createOfflineScope,
  isOfflineDbName,
  type OfflineKv,
} from "@/lib/offline-user-scope";

/**
 * Adaptateur idb-keyval du stockage hors ligne cloisonné : une base par compte,
 * un magasin `kv` (file `queue`, cache de lecture, fichiers `files:<id>`).
 * Module séparé de `offline-storage.ts` pour que la file (`offline-queue.ts`) et la
 * gestion de session puissent l'importer sans dépendance circulaire.
 */

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
