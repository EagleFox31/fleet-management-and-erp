import { get, set, del, clear, createStore, type UseStore } from "idb-keyval";
import { clientLogger } from "@/lib/logger";
import { createOfflineResume, RESUME_REVOKED_KEY, type RevokedStore } from "@/lib/offline-resume";
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
  // La base vidée est supprimée : la connexion de cet onglet est fermée d'abord (sinon
  // deleteDatabase reste bloquée), puis le magasin est oublié pour qu'un usage ultérieur rouvre une
  // base neuve. Une connexion d'un autre onglet retarde la suppression sans la perdre.
  async dropDb(db) {
    const store = stores.get(db);
    if (store) {
      await store("readonly", (s) => {
        s.transaction.db.close();
      });
      stores.delete(db);
    }
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(db);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    dbRegistry.remove(db);
  },
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
        // Énumération refusée : la liste serait incomplète (registre local seul). On le dit au lieu de la
        // rendre comme complète, l'appelant conclut « inconnu ».
        clientLogger.warn("Énumération des bases IndexedDB impossible", { err });
        throw err;
      }
    }
    return Array.from(names);
  },
  delLegacy: (key) => del(key),
};

export const offlineScope = createOfflineScope(idbKv);

/**
 * Marqueur de reprise hors ligne (voir `offline-resume.ts`) : sa propre base, jamais celle d'un cache de lecture.
 */
// localStorage résolu à chaque appel : absent (SSR, tests node) ou levant, la pierre tombale est ignorée.
const revokedStore: RevokedStore = {
  read: () => (typeof window === "undefined" ? null : window.localStorage.getItem(RESUME_REVOKED_KEY)),
  write: (value) => window.localStorage.setItem(RESUME_REVOKED_KEY, value),
  remove: () => window.localStorage.removeItem(RESUME_REVOKED_KEY),
};

export const offlineResume = createOfflineResume(idbKv, undefined, revokedStore);
