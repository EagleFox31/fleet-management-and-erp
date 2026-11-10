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

import {
  activateOfflineUser,
  enqueueOfflineAction,
  expireOfflineSession,
  offlineScope,
  purgeOfflineSession,
} from "@/lib/offline-storage";
import { getActiveOfflineUserId, setActiveOfflineUserId } from "@/lib/offline-user-scope";

const action = { type: "fuel_entry" as const, endpoint: "/api/x", method: "POST" as const, payload: {}, label: "Plein" };
const queueOf = (userId: number) => offlineScope.readQueue<{ label: string }>(userId);

beforeEach(() => {
  idb.dbs.clear();
  idb.gates.length = 0;
  toast.mockClear();
  setActiveOfflineUserId(null);
});

describe("expiration de session (401)", () => {
  it("vide le cache TanStack et l'utilisateur actif, garde la file d'écritures de A", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 5);
    client.setQueryData(["/api/technician/my-work-orders"], { workOrders: [] });
    await enqueueOfflineAction(action);
    expect(await queueOf(5)).toHaveLength(1);

    await expireOfflineSession(client, 5);

    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(await queueOf(5)).toHaveLength(1);
  });

  it("ne retire pas un compte qui s'est connecté depuis (401 tardif)", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 6);
    await expireOfflineSession(client, 5);
    expect(getActiveOfflineUserId()).toBe(6);
  });
});

describe("mise en file hors ligne et déconnexion", () => {
  it("la file est mise en file pour le compte actif", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 5);
    await enqueueOfflineAction(action);
    expect((await queueOf(5)).map((a) => a.label)).toEqual(["Plein"]);
  });

  it("une déconnexion pendant la lecture de la file n'écrit rien et prévient l'utilisateur", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 5);

    // La déconnexion s'exécute pendant la lecture de la file par l'ajout.
    let logout: Promise<void> | null = null;
    idb.gates.push(async () => {
      if (!logout) {
        idb.gates.length = 0;
        logout = purgeOfflineSession(client);
        await logout;
      }
    });
    await enqueueOfflineAction(action);

    expect(await queueOf(5)).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("sans utilisateur actif, refuse la mise en file", async () => {
    await enqueueOfflineAction(action);
    expect(idb.dbs.size).toBe(0);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});

describe("file v2 : drapeaux", () => {
  it("sans drapeau offline-writes, la mise en file est refusée et rien n'est écrit", async () => {
    const client = new QueryClient();
    activateOfflineUser(client, 5);
    const { queryClient } = await import("@/lib/queryClient");
    const spy = vi.spyOn(queryClient as unknown as { getQueryData: () => unknown }, "getQueryData").mockReturnValue({});
    await enqueueOfflineAction(action);
    spy.mockRestore();
    expect(await queueOf(5)).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });
});
