import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// IndexedDB en mémoire : une Map par base, comme les magasins idb-keyval nommés.
const idb = vi.hoisted(() => {
  const dbs = new Map<string, Map<string, unknown>>();
  const gates: Array<() => Promise<void>> = [];
  return { dbs, gates };
});

vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  get: async (key: string, store?: string) => {
    for (const gate of idb.gates) await gate();
    const value = idb.dbs.get(store ?? "keyval-store")?.get(key);
    return value === undefined ? undefined : structuredClone(value);
  },
  set: async (key: string, value: unknown, store?: string) => {
    const name = store ?? "keyval-store";
    if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
    idb.dbs.get(name)!.set(key, structuredClone(value));
  },
  del: async (key: string, store?: string) => void idb.dbs.get(store ?? "keyval-store")?.delete(key),
  clear: async (store?: string) => void idb.dbs.get(store ?? "keyval-store")?.clear(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast }));
// Drapeaux hors ligne allumés : la file v2 refuse de mettre en file sans eux.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { getQueryData: () => ({ "offline-writes": true, "driver-offline": true }) },
}));
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush: vi.fn(async () => "none") } }));
const channel = vi.hoisted(() => {
  const handlers = new Set<(m: unknown) => void>();
  return {
    handlers,
    posted: [] as unknown[],
    emit: (m: unknown) => handlers.forEach((h) => h(m)),
  };
});
vi.mock("@/lib/offline-session-channel", () => ({
  sessionChannel: {
    post: (m: unknown) => void channel.posted.push(m),
    subscribe: (h: (m: unknown) => void) => {
      channel.handlers.add(h);
      return () => channel.handlers.delete(h);
    },
  },
}));
vi.mock("@/lib/offline-queue", () => ({
  startOfflineQueueRuntime: () => () => undefined,
  replayOnReconnect: vi.fn(async () => undefined),
  cancelScheduledReplay: vi.fn(),
  pendingSendCount: vi.fn(async () => 0),
  refreshOfflineQueueSnapshot: vi.fn(async () => undefined),
  enqueueOfflineWrite: vi.fn(),
}));

import { activateOfflineUser, setupOfflinePersistence } from "@/lib/offline-storage";
import { getActiveOfflineUserId, setActiveOfflineUserId } from "@/lib/offline-user-scope";

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  channel.posted.length = 0;
  setActiveOfflineUserId(null);
});

describe("session-changed entre onglets (V5b-2b)", () => {
  it("un autre onglet connecte B : cet onglet adopte B sans réémettre", () => {
    const client = new QueryClient();
    const stop = setupOfflinePersistence(client);
    activateOfflineUser(client, 5, { broadcast: false });
    expect(getActiveOfflineUserId()).toBe(5);
    channel.emit({ type: "session-changed", userId: 9 });
    expect(getActiveOfflineUserId()).toBe(9);
    expect(channel.posted).toEqual([]);
    stop();
    channel.emit({ type: "session-changed", userId: 11 });
    expect(getActiveOfflineUserId()).toBe(9);
  });

  it("la connexion locale diffuse session-changed", () => {
    const client = new QueryClient();
    activateOfflineUser(client, 5);
    expect(channel.posted).toEqual([{ type: "session-changed", userId: 5 }]);
  });

  it("un message pour le compte déjà actif ne change rien", () => {
    const client = new QueryClient();
    const stop = setupOfflinePersistence(client);
    activateOfflineUser(client, 5, { broadcast: false });
    channel.emit({ type: "session-changed", userId: 5 });
    expect(getActiveOfflineUserId()).toBe(5);
    stop();
  });
});
