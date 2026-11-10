import { beforeEach, describe, expect, it, vi } from "vitest";

// Changement de compte et tampon GPS (S1, suite de #678) : le scénario A/B de l'audit.
const idb = vi.hoisted(() => ({ dbs: new Map<string, Map<string, unknown>>() }));
vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  get: async (key: string, store?: string) => idb.dbs.get(store ?? "keyval-store")?.get(key),
  set: async (key: string, value: unknown, store?: string) => {
    const name = store ?? "keyval-store";
    if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
    idb.dbs.get(name)!.set(key, value);
  },
  del: async (key: string, store?: string) => void idb.dbs.get(store ?? "keyval-store")?.delete(key),
  clear: async (store?: string) => void idb.dbs.get(store ?? "keyval-store")?.clear(),
}));
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest,
  queryClient: { getQueryData: () => ({ "offline-writes": true, "driver-offline": true }), invalidateQueries: vi.fn() },
}));
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush: vi.fn(async () => "none") } }));
vi.mock("@/lib/offline-session-channel", () => ({ sessionChannel: { post: vi.fn(), subscribe: () => () => undefined } }));
vi.mock("@/lib/offline-queue", () => ({
  startOfflineQueueRuntime: () => () => undefined,
  replayOnReconnect: vi.fn(async () => undefined),
  cancelScheduledReplay: vi.fn(),
  pendingSendCount: vi.fn(async () => 0),
  refreshOfflineQueueSnapshot: vi.fn(async () => undefined),
  enqueueOfflineWrite: vi.fn(),
}));

import { QueryClient } from "@tanstack/react-query";
import { flushTrackingSession, replayOrphanBuffers } from "@/hooks/use-gps-tracking";
import { gpsBufferKey, gpsPurgeEpoch, type GpsPoint } from "@/lib/gps-tracking";
import { activateOfflineUser, onSessionChannelMessage } from "@/lib/offline-storage";
import { setActiveOfflineUserId } from "@/lib/offline-user-scope";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const point = (n: number): GpsPoint => ({ clientPointId: `id-${n}`, recordedAt: new Date(NOW - n * 1000).toISOString(), lat: 4, lng: 9 });

let map: Map<string, string>;
beforeEach(() => {
  apiRequest.mockReset();
  map = new Map();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: {
      get length() {
        return map.size;
      },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  vi.setSystemTime(NOW);
  setActiveOfflineUserId(7);
});

function sessionOfA() {
  const key = gpsBufferKey(7, 11);
  map.set(key, JSON.stringify([point(1)]));
  return { key, userId: 7, missionId: 11, epoch: gpsPurgeEpoch(), buffer: [point(1)], flushing: false, closed: false };
}

describe("changement de compte : le GPS suit le canal de la file hors ligne (S1)", () => {
  it("B se connecte dans un autre onglet (session-changed) : le flush de A ne part pas, son tampon est détruit", async () => {
    const session = sessionOfA();
    onSessionChannelMessage(new QueryClient(), { type: "session-changed", userId: 8 } as never);
    await flushTrackingSession(session);
    await replayOrphanBuffers(7);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(map.has(session.key)).toBe(false);
  });

  it("B se connecte dans le même onglet (activateOfflineUser) : même résultat", async () => {
    const session = sessionOfA();
    activateOfflineUser(new QueryClient(), 8, { broadcast: false });
    await flushTrackingSession(session);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(map.has(session.key)).toBe(false);
  });

  it("le même compte qui se réactive ne purge rien", async () => {
    const session = sessionOfA();
    activateOfflineUser(new QueryClient(), 7, { broadcast: false });
    expect(gpsPurgeEpoch()).toBe(session.epoch);
    expect(map.has(session.key)).toBe(true);
  });
});
