import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// L'événement `online` après une déconnexion à purge incomplète relance la purge locale avant
// d'effacer le repère (le repère est géré par pending-logout, voir pending-logout-purge.test.ts).
const idb = vi.hoisted(() => ({
  dbs: new Map<string, Map<string, unknown>>(),
  nameOf: (store: unknown): string | undefined =>
    typeof store === "function" ? (store as unknown as { dbName: string }).dbName : (store as string | undefined),
}));
vi.mock("idb-keyval", () => ({
  // Magasin appelable comme celui d'idb-keyval (dropDb en ferme la connexion) ; `dbName` le nomme.
  createStore: (db: string) =>
    Object.assign(async (_mode: string, run: (s: unknown) => unknown) => run({ transaction: { db: { close() {} } } }), { dbName: db }),
  get: async (key: string, store?: unknown) => idb.dbs.get(idb.nameOf(store) ?? "keyval-store")?.get(key),
  set: async (key: string, value: unknown, store?: unknown) => {
    const name = idb.nameOf(store) ?? "keyval-store";
    if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
    idb.dbs.get(name)!.set(key, value);
  },
  del: async (key: string, store?: unknown) => void idb.dbs.get(idb.nameOf(store) ?? "keyval-store")?.delete(key),
  clear: async (store?: unknown) => void idb.dbs.get(idb.nameOf(store) ?? "keyval-store")?.clear(),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { getQueryData: () => ({}), invalidateQueries: vi.fn(async () => undefined) },
}));
const flush = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush } }));

import { activateOfflineUser, offlineScope, setupOfflinePersistence } from "@/lib/offline-storage";
import { setActiveOfflineUserId } from "@/lib/offline-user-scope";

const handlers = new Map<string, () => void>();
const lsData = new Map<string, string>([["fleetos-draft-x", "brouillon"]]);
const fakeWindow = {
  localStorage: {
    get length() {
      return lsData.size;
    },
    key: (i: number) => Array.from(lsData.keys())[i] ?? null,
    getItem: (k: string) => lsData.get(k) ?? null,
    setItem: (k: string, v: string) => void lsData.set(k, v),
    removeItem: (k: string) => void lsData.delete(k),
  },
  addEventListener: (name: string, fn: () => void) => void handlers.set(name, fn),
  removeEventListener: (name: string) => void handlers.delete(name),
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  idb.dbs.clear();
  handlers.clear();
  flush.mockReset();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("indexedDB", {
    databases: async () => Array.from(idb.dbs.keys()).map((name) => ({ name })),
    deleteDatabase: (name: string) => {
      idb.dbs.delete(name);
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  setActiveOfflineUserId(null);
});

describe("événement online après une déconnexion à purge incomplète", () => {
  it("demande la purge locale avant d'effacer le repère et la mène à bout", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 7, { broadcast: false });
    await offlineScope.saveCache(7, [{ queryKey: ["/api/drivers/me"], state: { data: { driver: { id: 7 } }, dataUpdatedAt: 1 } }], Date.now(), () => true);
    let purged: boolean | void = undefined;
    flush.mockImplementation(async (options?: { beforeClear?: () => Promise<boolean | void> }) => {
      purged = await options?.beforeClear?.();
      return purged === false ? "pending" : "sent";
    });
    const stop = setupOfflinePersistence(client);
    handlers.get("online")?.();
    await tick(50);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(purged).toBe(true);
    expect(idb.dbs.get("fleetos-offline-u7")?.get("query-cache")).toBeUndefined();
    stop();
  });
});
