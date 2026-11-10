import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  // Drapeaux du module de file : volontairement ETEINTS, la restauration ne doit pas en dépendre.
  queryClient: { getQueryData: () => ({}) },
}));
vi.mock("@/lib/pending-logout", () => ({ pendingServerLogout: { flush: vi.fn(async () => "none") } }));

import {
  activateOfflineUser,
  expireOfflineSession,
  offlineScope,
  onSessionChannelMessage,
  purgeOfflineSession,
  recordOfflineResume,
  refreshOfflineResume,
  resumeOfflineRead,
  isNetworkSuccess,
} from "@/lib/offline-storage";
import { offlineResume } from "@/lib/offline-kv";
import { RESUME_DB, RESUME_KEY, RESUME_TTL_MS } from "@/lib/offline-resume";
import { getActiveOfflineUserId, setActiveOfflineUserId } from "@/lib/offline-user-scope";

const ME = "/api/drivers/me";
const FLAGS = "/api/feature-flags";
const ON = { "driver-offline": true, "offline-writes": true };
const flagOn = (f: string) => ON[f as keyof typeof ON] === true;
const T0 = Date.now();
const markerRaw = () => idb.dbs.get(RESUME_DB)?.get(RESUME_KEY) as Record<string, unknown> | undefined;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const driverQuery = (id: number, updatedAt = T0 - 5000) => ({
  queryKey: [ME],
  state: { data: { driver: { id, firstName: "P" }, missions: [] }, status: "success", dataUpdatedAt: updatedAt },
});

/** Un chauffeur `id` s'est connecté en ligne : marqueur écrit, copie de lecture sauvegardée. */
async function onlineSession(id: number, flags: Record<string, boolean> | null = ON) {
  const client = new QueryClient();
  activateOfflineUser(client, id, { broadcast: false });
  // Après l activation : changer de compte vide le cache TanStack, les drapeaux arrivent ensuite.
  if (flags) client.setQueryData([FLAGS], flags);
  await recordOfflineResume(client, { id, role: "driver" }, T0);
  await offlineScope.saveCache(id, [driverQuery(id)], T0, flagOn);
  return client;
}

/** Démarrage hors ligne : mémoire vide, aucun compte actif. */
function coldStart() {
  setActiveOfflineUserId(null);
  return new QueryClient();
}

beforeEach(() => {
  idb.dbs.clear();
  setActiveOfflineUserId(null);
});

describe("restauration au démarrage hors ligne", () => {
  it("marqueur valide : le compte devient actif et la copie de lecture est restaurée, marquée périmée", async () => {
    await onlineSession(7);
    const client = coldStart();
    expect(await resumeOfflineRead(client, T0 + 3600_000)).toBe(true);
    expect(getActiveOfflineUserId()).toBe(7);
    expect(client.getQueryData([ME])).toEqual({ driver: { id: 7, firstName: "P" }, missions: [] });
    expect(client.getQueryState([ME])?.isInvalidated).toBe(true);
  });

  it("lecture seule : la file d'envois n'est pas touchée et aucun drapeau n'est injecté", async () => {
    await onlineSession(7);
    const queueBefore = idb.dbs.get("fleetos-offline-u7")?.get("queue");
    const client = coldStart();
    await resumeOfflineRead(client, T0 + 1000);
    expect(idb.dbs.get("fleetos-offline-u7")?.get("queue")).toEqual(queueBefore);
    expect(await offlineScope.readQueue(7)).toEqual([]);
    expect(client.getQueryData([FLAGS])).toBeUndefined();
  });

  it("marqueur expiré : rien n'est activé ni restauré", async () => {
    await onlineSession(7);
    const client = coldStart();
    expect(await resumeOfflineRead(client, T0 + RESUME_TTL_MS + 1)).toBe(false);
    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(markerRaw()).toBeUndefined();
  });

  it("aucun marqueur : rien", async () => {
    expect(await resumeOfflineRead(coldStart(), T0)).toBe(false);
    expect(getActiveOfflineUserId()).toBeNull();
  });

  it("marqueur valide mais driver-offline éteint au dernier contact : rien", async () => {
    await onlineSession(7, { "driver-offline": false, "offline-writes": true });
    const client = coldStart();
    expect(await resumeOfflineRead(client, T0 + 1000)).toBe(false);
    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("drapeaux jamais lus (absents du cache) : éteints, rien n'est restauré", async () => {
    await onlineSession(7, null);
    expect(await resumeOfflineRead(coldStart(), T0 + 1000)).toBe(false);
  });

  it("un compte déjà actif en mémoire n'est pas remplacé", async () => {
    await onlineSession(7);
    setActiveOfflineUserId(9);
    expect(await resumeOfflineRead(new QueryClient(), T0 + 1000)).toBe(false);
    expect(getActiveOfflineUserId()).toBe(9);
  });

  it("plusieurs relances hors ligne : l'échéance ne bouge pas", async () => {
    await onlineSession(7);
    const before = structuredClone(markerRaw());
    for (const h of [1, 10, 30, 60]) {
      expect(await resumeOfflineRead(coldStart(), T0 + h * 3600_000)).toBe(true);
    }
    expect(markerRaw()).toEqual(before);
  });

  it("le compte B ne lit jamais la copie de A", async () => {
    await onlineSession(7);
    const clientB = new QueryClient();
    activateOfflineUser(clientB, 8, { broadcast: false });
    clientB.setQueryData([FLAGS], ON);
    await recordOfflineResume(clientB, { id: 8, role: "driver" }, T0 + 1000);
    await tick(10);
    const offline = coldStart();
    await resumeOfflineRead(offline, T0 + 2000);
    expect(getActiveOfflineUserId()).toBe(8);
    expect(JSON.stringify(offline.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('"id":7');
    expect(await offlineScope.loadCache(8, T0 + 2000, flagOn)).toEqual([]);
  });

  it("marqueur trafiqué vers un autre compte : rien de l'ancien n'est lu sous la nouvelle identité", async () => {
    await onlineSession(7);
    idb.dbs.get(RESUME_DB)!.set(RESUME_KEY, { ...markerRaw()!, userId: 8 });
    const client = coldStart();
    await resumeOfflineRead(client, T0 + 1000);
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('"id":7');
  });
});

describe("écriture et rafraîchissement du marqueur", () => {
  it("un profil non chauffeur n'écrit rien et efface un marqueur précédent", async () => {
    await onlineSession(7);
    const client = new QueryClient();
    client.setQueryData([FLAGS], ON);
    await recordOfflineResume(client, { id: 9, role: "technician" }, T0 + 1000);
    expect(markerRaw()).toBeUndefined();
  });

  it("le contact réseau du compte actif repousse l'échéance", async () => {
    const client = await onlineSession(7);
    await refreshOfflineResume(client, T0 + 60_000);
    expect(markerRaw()).toMatchObject({ lastOnlineAt: T0 + 60_000, expiresAt: T0 + 60_000 + RESUME_TTL_MS });
  });

  it("sans compte actif, un contact réseau n'écrit rien", async () => {
    const client = await onlineSession(7);
    setActiveOfflineUserId(null);
    const before = structuredClone(markerRaw());
    await refreshOfflineResume(client, T0 + 999_999);
    expect(markerRaw()).toEqual(before);
  });

  it("une extinction du drapeau constatée en ligne est reportée dans le marqueur", async () => {
    const client = await onlineSession(7);
    client.setQueryData([FLAGS], { "driver-offline": false, "offline-writes": true });
    await refreshOfflineResume(client, T0 + 1000);
    expect((markerRaw()!.flags as Record<string, boolean>)["driver-offline"]).toBe(false);
    expect(await resumeOfflineRead(coldStart(), T0 + 2000)).toBe(false);
  });
});

describe("purge du marqueur", () => {
  it("déconnexion explicite", async () => {
    const client = await onlineSession(7);
    await purgeOfflineSession(client);
    expect(markerRaw()).toBeUndefined();
  });

  it("changement d'utilisateur", async () => {
    const client = await onlineSession(7);
    activateOfflineUser(client, 8);
    await tick(10);
    expect(markerRaw()).toBeUndefined();
  });

  it("401 : au même moment que la purge de la copie de lecture", async () => {
    const client = await onlineSession(7);
    await expireOfflineSession(client, 7);
    expect(markerRaw()).toBeUndefined();
    expect(await offlineScope.loadCache(7, T0, flagOn)).toEqual([]);
  });

  it("401 tardif d'un autre compte : le marqueur du compte actif reste", async () => {
    const client = await onlineSession(7);
    await expireOfflineSession(client, 5);
    expect(markerRaw()).toBeDefined();
  });

  it("session-changed d'un autre onglet (autre compte)", async () => {
    const client = await onlineSession(7);
    onSessionChannelMessage(client, { type: "session-changed", userId: 8 });
    await tick(10);
    expect(markerRaw()).toBeUndefined();
  });

  it("session-changed du même compte : le marqueur écrit par l'autre onglet reste", async () => {
    const client = await onlineSession(7);
    onSessionChannelMessage(client, { type: "session-changed", userId: 7 });
    await tick(10);
    expect(markerRaw()).toBeDefined();
  });

  it("logout d'un autre onglet", async () => {
    const client = await onlineSession(7);
    onSessionChannelMessage(client, { type: "logout" });
    await tick(20);
    expect(markerRaw()).toBeUndefined();
  });

  it("/me renvoie un autre compte que le marqueur : le marqueur est remplacé", async () => {
    await onlineSession(7);
    const client = new QueryClient();
    client.setQueryData([FLAGS], ON);
    await recordOfflineResume(client, { id: 8, role: "driver" }, T0 + 1000);
    expect(markerRaw()).toMatchObject({ userId: 8 });
  });

  it("/me renvoie un compte non chauffeur : le marqueur est effacé", async () => {
    await onlineSession(7);
    await recordOfflineResume(new QueryClient(), { id: 7, role: "technician" }, T0 + 1000);
    expect(markerRaw()).toBeUndefined();
  });

  it("expiration constatée à la lecture", async () => {
    await onlineSession(7);
    expect(await offlineResume.read(T0 + RESUME_TTL_MS + 60_000)).toBeNull();
    expect(markerRaw()).toBeUndefined();
  });
});

describe("preuve de contact réseau", () => {
  it("seule une lecture réseau réussie compte, pas une écriture manuelle du cache", () => {
    expect(isNetworkSuccess({ type: "updated", action: { type: "success" } })).toBe(true);
    expect(isNetworkSuccess({ type: "updated", action: { type: "success", manual: true } })).toBe(false);
    expect(isNetworkSuccess({ type: "updated", action: { type: "error" } })).toBe(false);
    expect(isNetworkSuccess({ type: "added" })).toBe(false);
  });
});
