import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Suite de #681 : réouverture hors ligne d'un autre compte, et refus 409 du propriétaire du paquet.
const idb = vi.hoisted(() => ({ dbs: new Map<string, Map<string, unknown>>() }));
vi.mock("idb-keyval", () => ({
  createStore: (db: string) => db,
  get: async (key: string, store?: string) => {
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
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({
  apiRequest,
  queryClient: {
    getQueryData: () => ({ "offline-writes": true, "driver-offline": true }),
    invalidateQueries: vi.fn(async () => undefined),
  },
}));
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush: vi.fn(async () => "none") } }));

import { replayOrphanBuffers } from "@/hooks/use-gps-tracking";
import { ApiError } from "@/lib/api-error";
import { gpsBufferKey, gpsPurgeEpoch, type GpsPoint } from "@/lib/gps-tracking";
import { offlineResume } from "@/lib/offline-kv";
import { resumeOfflineRead } from "@/lib/offline-storage";
import { setActiveOfflineUserId } from "@/lib/offline-user-scope";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const point = (n: number): GpsPoint => ({ clientPointId: `id-${n}`, recordedAt: new Date(NOW - n * 1000).toISOString(), lat: 4, lng: 9 });

const map = new Map<string, string>();
const setItem = vi.fn((k: string, v: string) => void map.set(k, v));
const fakeWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  localStorage: {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem,
    removeItem: (k: string) => void map.delete(k),
  },
};

beforeEach(() => {
  idb.dbs.clear();
  map.clear();
  setItem.mockClear();
  apiRequest.mockReset();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("navigator", { onLine: false });
  vi.stubGlobal("indexedDB", {
    databases: async () => Array.from(idb.dbs.keys()).map((name) => ({ name })),
    deleteDatabase: (name: string) => {
      idb.dbs.delete(name);
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  vi.setSystemTime(NOW);
  setActiveOfflineUserId(null);
});

describe("réouverture hors ligne (resumeOfflineRead) : même cloison que la connexion (S1)", () => {
  it("B rouvre l'appareil alors qu'un tampon GPS de A existe : le tampon de A est détruit, celui de B reste", async () => {
    const keyA = gpsBufferKey(7, 11);
    const keyB = gpsBufferKey(8, 12);
    map.set(keyA, JSON.stringify([point(1)]));
    map.set(keyB, JSON.stringify([point(2)]));
    await offlineResume.record({ id: 8, role: "driver" }, { "driver-offline": true, "offline-writes": true }, NOW);
    const epoch = gpsPurgeEpoch();

    const grant = await resumeOfflineRead(new QueryClient(), NOW);

    expect(grant?.userId).toBe(8);
    expect(map.has(keyA)).toBe(false);
    expect(map.has(keyB)).toBe(true);
    // Les envois en vol de A (époque relevée avant) ne repartent pas.
    expect(gpsPurgeEpoch()).toBeGreaterThan(epoch);
  });
});

describe("409 OFFLINE_OWNER_MISMATCH : le paquet est retiré", () => {
  it("un seul envoi, tampon vidé, aucune réécriture des points", async () => {
    setActiveOfflineUserId(7);
    const key = gpsBufferKey(7, 11);
    map.set(key, JSON.stringify([point(1), point(2)]));
    apiRequest.mockRejectedValue(
      new ApiError(409, "Ce paquet appartient à un autre compte.", { code: "OFFLINE_OWNER_MISMATCH" }),
    );

    await replayOrphanBuffers(7);
    await replayOrphanBuffers(7);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(map.has(key)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
