import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reprise hors ligne et rejeu de la file : un compte rouvert depuis le marqueur n'envoie rien
// tant que /api/auth/me n'a pas confirmé la session dans cette page.
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

import {
  activateOfflineUser,
  offlineScope,
  resumeOfflineRead,
  setupOfflinePersistence,
} from "@/lib/offline-storage";
import { enqueueOfflineWrite, replayOfflineQueue } from "@/lib/offline-queue";
import { RESUME_DB, RESUME_KEY } from "@/lib/offline-resume";
import { offlineResume } from "@/lib/offline-kv";
import { RESUME_DB, RESUME_KEY } from "@/lib/offline-resume";
import { confirmOfflineSession, getActiveOfflineUserId, setActiveOfflineUserId } from "@/lib/offline-user-scope";

const ON = { "driver-offline": true, "offline-writes": true };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const lsData = new Map<string, string>();
const handlers = new Map<string, () => void>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => lsData.get(k) ?? null,
    setItem: (k: string, v: string) => void lsData.set(k, v),
    removeItem: (k: string) => void lsData.delete(k),
  },
  addEventListener: (name: string, fn: () => void) => void handlers.set(name, fn),
  removeEventListener: (name: string) => void handlers.delete(name),
};
const fetchMock = vi.fn();

async function queuedSession(userId: number) {
  vi.stubGlobal("navigator", { onLine: false });
  const client = new QueryClient();
  activateOfflineUser(client, userId, { broadcast: false });
  const queued = await enqueueOfflineWrite({
    type: "odometer_reading",
    endpoint: "/api/vehicles/1/mileage",
    method: "PUT",
    payload: { mileage: 10 },
    label: "Relevé",
  });
  expect(queued.queued).toBe(true);
  await offlineResume.record({ id: userId, role: "driver" }, ON, Date.now());
  // Page neuve : plus de compte actif, rien n'est confirmé.
  setActiveOfflineUserId(null);
  confirmOfflineSession(userId);
  vi.stubGlobal("navigator", { onLine: true });
}

beforeEach(() => {
  idb.dbs.clear();
  lsData.clear();
  handlers.clear();
  apiRequest.mockReset();
  apiRequest.mockResolvedValue(new Response("{}", { status: 200 }));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 7, role: "driver" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", fakeWindow);
  setActiveOfflineUserId(null);
});

describe("C1 : aucun rejeu avant la confirmation de la session", () => {
  it("compte rouvert depuis le marqueur, réseau revenu : l'événement online n'envoie rien", async () => {
    await queuedSession(7);
    const stop = setupOfflinePersistence(new QueryClient());
    expect(await resumeOfflineRead(new QueryClient())).toBe(true);
    expect(getActiveOfflineUserId()).toBe(7);

    handlers.get("online")?.();
    await tick(60);

    expect(apiRequest).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await offlineScope.readQueue(7)).length).toBe(1);
    stop();
  });

  it("/me authentifié (activateOfflineUser) : la file de ce compte part alors", async () => {
    await queuedSession(7);
    const stop = setupOfflinePersistence(new QueryClient());
    await resumeOfflineRead(new QueryClient());
    handlers.get("online")?.();
    await tick(30);
    expect(apiRequest).not.toHaveBeenCalled();

    activateOfflineUser(new QueryClient(), 7, { broadcast: false });
    await tick(120);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("réserve 1 : session refusée pendant la vérification du propriétaire de la file", () => {
  it("401 sur /api/auth/me au rejeu : le marqueur de reprise est effacé", async () => {
    await queuedSession(7);
    activateOfflineUser(new QueryClient(), 7, { broadcast: false });
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(idb.dbs.get(RESUME_DB)?.get(RESUME_KEY)).toBeDefined();
    await tick(40);
    await replayOfflineQueue({ ignoreBackoff: true });
    await tick(20);
    expect(idb.dbs.get(RESUME_DB)?.get(RESUME_KEY)).toBeUndefined();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe("réserve 2 : câblage du contact réseau (touch)", () => {
  const markerOf = () => idb.dbs.get(RESUME_DB)?.get(RESUME_KEY) as { lastOnlineAt: number } | undefined;
  const old = Date.now() - 5 * 3600_000;

  async function connected() {
    vi.stubGlobal("navigator", { onLine: true });
    const client = new QueryClient();
    activateOfflineUser(client, 7, { broadcast: false });
    await offlineResume.record({ id: 7, role: "driver" }, ON, old);
    const stop = setupOfflinePersistence(client);
    return { client, stop };
  }

  it("une lecture ordinaire (liste) ne prolonge pas, même en réseau", async () => {
    const { client, stop } = await connected();
    await client.fetchQuery({ queryKey: ["/api/missions"], queryFn: async () => [] });
    await tick(20);
    expect(markerOf()!.lastOnlineAt).toBe(old);
    stop();
  });

  it("une donnée posée à la main (copie servie par IndexedDB) ne prolonge pas", async () => {
    const { client, stop } = await connected();
    client.setQueryData(["/api/feature-flags"], ON);
    await tick(20);
    expect(markerOf()!.lastOnlineAt).toBe(old);
    stop();
  });

  it("l'arrivée des drapeaux par le réseau prolonge tout de suite, à chaque fois", async () => {
    const { client, stop } = await connected();
    await client.fetchQuery({ queryKey: ["/api/feature-flags"], queryFn: async () => ON });
    await tick(20);
    const first = markerOf()!.lastOnlineAt;
    expect(first).toBeGreaterThan(old);
    await offlineResume.record({ id: 7, role: "driver" }, ON, old);
    await client.fetchQuery({ queryKey: ["/api/feature-flags"], queryFn: async () => ON, staleTime: 0 });
    await tick(20);
    expect(markerOf()!.lastOnlineAt).toBeGreaterThan(old);
    stop();
  });

  it("/api/auth/me : une écriture par minute au plus", async () => {
    const { client, stop } = await connected();
    await client.fetchQuery({ queryKey: ["/api/auth/me"], queryFn: async () => ({ id: 7 }) });
    await tick(20);
    expect(markerOf()!.lastOnlineAt).toBeGreaterThan(old);
    await offlineResume.record({ id: 7, role: "driver" }, ON, old);
    await client.fetchQuery({ queryKey: ["/api/auth/me"], queryFn: async () => ({ id: 7 }), staleTime: 0 });
    await tick(20);
    expect(markerOf()!.lastOnlineAt).toBe(old);
    stop();
  });
});
