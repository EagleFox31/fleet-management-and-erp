import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = vi.hoisted(() => ({
  dbs: new Map<string, Map<string, unknown>>(),
  // Suppression IndexedDB en panne, pour la pierre tombale.
  failDelOf: null as string | null,
  // Lecture en vol : la valeur est lue, puis rendue après la porte (course avec un logout).
  gate: null as Promise<void> | null,
}));
const nameOf = vi.hoisted(() => (store: unknown): string | undefined =>
  typeof store === "function" ? (store as unknown as { dbName: string }).dbName : (store as string | undefined));

vi.mock("idb-keyval", () => ({
  // Magasin appelable comme celui d'idb-keyval (dropDb en ferme la connexion) ; `dbName` le nomme.
  createStore: (db: string) => Object.assign(async (_mode: string, run: (s: unknown) => unknown) => run({ transaction: { db: { close() {} } } }), { dbName: db }),
  get: async (key: string, rawStore?: unknown) => {
    const store = nameOf(rawStore);
    const value = idb.dbs.get(store ?? "keyval-store")?.get(key);
    if (idb.gate && store === "fleetos-offline-resume") await idb.gate;
    return value === undefined ? undefined : structuredClone(value);
  },
  set: async (key: string, value: unknown, rawStore?: unknown) => {
    const name = nameOf(rawStore) ?? "keyval-store";
    if (!idb.dbs.has(name)) idb.dbs.set(name, new Map());
    idb.dbs.get(name)!.set(key, structuredClone(value));
  },
  del: async (key: string, rawStore?: unknown) => {
    const store = nameOf(rawStore);
    if (idb.failDelOf !== null && store === idb.failDelOf) throw new Error("IndexedDB indisponible");
    idb.dbs.get(store ?? "keyval-store")?.delete(key);
  },
  clear: async (rawStore?: unknown) => void idb.dbs.get(nameOf(rawStore) ?? "keyval-store")?.clear(),
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
  isContactProof,
} from "@/lib/offline-storage";
import { offlineResume } from "@/lib/offline-kv";
import { RESUME_DB, RESUME_KEY, RESUME_REVOKED_KEY, RESUME_TTL_MS } from "@/lib/offline-resume";
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

/** localStorage factice : la pierre tombale y vit. */
const lsData = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => lsData.get(k) ?? null,
    setItem: (k: string, v: string) => void lsData.set(k, v),
    removeItem: (k: string) => void lsData.delete(k),
  },
};

/** IndexedDB factice : énumère les bases du faux idb-keyval et accepte leur suppression (sans bruit sur stderr). */
function fakeIndexedDb() {
  return {
    databases: async () => Array.from(idb.dbs.keys()).map((name) => ({ name })),
    deleteDatabase: (name: string) => {
      idb.dbs.delete(name);
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("indexedDB", fakeIndexedDb());
  lsData.clear();
  idb.failDelOf = null;
  idb.gate = null;
  idb.dbs.clear();
  setActiveOfflineUserId(null);
});

describe("restauration au démarrage hors ligne", () => {
  it("marqueur valide : le compte devient actif et la copie de lecture est restaurée, marquée périmée", async () => {
    await onlineSession(7);
    const client = coldStart();
    expect(await resumeOfflineRead(client, T0 + 3600_000)).not.toBeNull();
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
    expect(await resumeOfflineRead(client, T0 + RESUME_TTL_MS + 1)).toBeNull();
    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(markerRaw()).toBeUndefined();
  });

  it("aucun marqueur : rien", async () => {
    expect(await resumeOfflineRead(coldStart(), T0)).toBeNull();
    expect(getActiveOfflineUserId()).toBeNull();
  });

  it("marqueur valide mais driver-offline éteint au dernier contact : rien", async () => {
    await onlineSession(7, { "driver-offline": false, "offline-writes": true });
    const client = coldStart();
    expect(await resumeOfflineRead(client, T0 + 1000)).toBeNull();
    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("drapeaux jamais lus (absents du cache) : éteints, rien n'est restauré", async () => {
    await onlineSession(7, null);
    expect(await resumeOfflineRead(coldStart(), T0 + 1000)).toBeNull();
  });

  it("un compte déjà actif en mémoire n'est pas remplacé", async () => {
    await onlineSession(7);
    setActiveOfflineUserId(9);
    expect(await resumeOfflineRead(new QueryClient(), T0 + 1000)).toBeNull();
    expect(getActiveOfflineUserId()).toBe(9);
  });

  it("plusieurs relances hors ligne : l'échéance ne bouge pas", async () => {
    await onlineSession(7);
    for (const h of [1, 10, 30, 60]) {
      expect(await resumeOfflineRead(coldStart(), T0 + h * 3600_000)).not.toBeNull();
      expect(markerRaw()).toMatchObject({ lastOnlineAt: T0, expiresAt: T0 + RESUME_TTL_MS });
    }
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

describe("restauration : propriétaire", () => {
  describe("propriétaire du cache avant tout affichage (V5b-3c)", () => {
    it("magasin du compte 7 dont l'enveloppe porte un autre propriétaire : purge locale, aucun grant", async () => {
      await onlineSession(7);
      const store = idb.dbs.get("fleetos-offline-u7")!;
      const envelope = store.get("query-cache") as Record<string, unknown>;
      store.set("query-cache", { ...envelope, userId: 9 });
      const client = coldStart();
      expect(await resumeOfflineRead(client, T0 + 1000)).toBeNull();
      expect(getActiveOfflineUserId()).toBeNull();
      expect(markerRaw()).toBeUndefined();
      expect(idb.dbs.get("fleetos-offline-u7")?.get("query-cache")).toBeUndefined();
      expect(client.getQueryCache().getAll()).toHaveLength(0);
    });

    it("copie de lecture d'un autre compte (9) présente sur l'appareil : purge locale, aucun grant", async () => {
      await onlineSession(7);
      idb.dbs.set("fleetos-offline-u9", new Map([["query-cache", { version: 1, userId: 9, timestamp: T0, queries: [] }]]));
      expect(await resumeOfflineRead(coldStart(), T0 + 1000)).toBeNull();
      expect(getActiveOfflineUserId()).toBeNull();
      expect(markerRaw()).toBeUndefined();
      expect(idb.dbs.get("fleetos-offline-u9")?.get("query-cache")).toBeUndefined();
    });

    it("propriétaire conforme : le grant porte userId, profil et échéance, jamais un rôle", async () => {
      await onlineSession(7);
      const grant = await resumeOfflineRead(coldStart(), T0 + 1000);
      expect(grant).toEqual({ userId: 7, profile: "driver", expiresAt: T0 + RESUME_TTL_MS });
    });
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

  it("une extinction du drapeau constatée en ligne supprime le marqueur tout de suite", async () => {
    const client = await onlineSession(7);
    client.setQueryData([FLAGS], { "driver-offline": false, "offline-writes": true });
    await refreshOfflineResume(client, T0 + 1000);
    expect(markerRaw()).toBeUndefined();
    expect(await resumeOfflineRead(coldStart(), T0 + 2000)).toBeNull();
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

describe("pierre tombale : suppression IndexedDB en échec à la déconnexion", () => {
  it("déconnexion hors ligne, suppression refusée, redémarrage sans réseau : aucune restauration", async () => {
    const client = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await purgeOfflineSession(client);
    // Le marqueur est resté dans IndexedDB, mais la pierre tombale le révoque.
    expect(markerRaw()).toBeDefined();
    expect(JSON.parse(lsData.get(RESUME_REVOKED_KEY)!)).toEqual({ userId: 7 });
    const cold = coldStart();
    expect(await resumeOfflineRead(cold, T0 + 1000)).toBeNull();
    expect(getActiveOfflineUserId()).toBeNull();
    expect(cold.getQueryCache().getAll()).toEqual([]);
  });

  it("le démarrage suivant retente la purge : marqueur supprimé, pierre levée quand elle aboutit", async () => {
    const client = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await purgeOfflineSession(client);
    expect(await resumeOfflineRead(coldStart(), T0 + 1000)).toBeNull();
    expect(lsData.has(RESUME_REVOKED_KEY)).toBe(true);
    idb.failDelOf = null;
    expect(await resumeOfflineRead(coldStart(), T0 + 2000)).toBeNull();
    expect(markerRaw()).toBeUndefined();
    expect(lsData.has(RESUME_REVOKED_KEY)).toBe(false);
  });

  it("la pierre tombale ne contient que le userId", async () => {
    const client = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await purgeOfflineSession(client);
    expect(Object.keys(JSON.parse(lsData.get(RESUME_REVOKED_KEY)!))).toEqual(["userId"]);
  });

  it("pierre tombale d'un autre userId : un autre compte qui se reconnecte en ligne n'est pas bloqué, la pierre est effacée", async () => {
    const clientA = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await purgeOfflineSession(clientA);
    idb.failDelOf = null;
    expect(lsData.has(RESUME_REVOKED_KEY)).toBe(true);
    await onlineSession(8);
    expect(lsData.has(RESUME_REVOKED_KEY)).toBe(false);
    expect(markerRaw()).toMatchObject({ userId: 8 });
    expect(await resumeOfflineRead(coldStart(), T0 + 1000)).not.toBeNull();
    expect(getActiveOfflineUserId()).toBe(8);
  });

  it("suppression qui aboutit : pas de pierre tombale", async () => {
    const client = await onlineSession(7);
    await purgeOfflineSession(client);
    expect(lsData.has(RESUME_REVOKED_KEY)).toBe(false);
    expect(markerRaw()).toBeUndefined();
  });

  it("401 avec suppression refusée : même pierre tombale", async () => {
    const client = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await expireOfflineSession(client, 7);
    expect(JSON.parse(lsData.get(RESUME_REVOKED_KEY)!)).toEqual({ userId: 7 });
    expect(await resumeOfflineRead(coldStart(), T0 + 1000)).toBeNull();
  });

  it("pierre tombale : aucun rafraîchissement d'échéance", async () => {
    const client = await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    await purgeOfflineSession(client);
    setActiveOfflineUserId(7);
    const before = structuredClone(markerRaw());
    await refreshOfflineResume(client, T0 + 60_000);
    expect(markerRaw()).toEqual(before);
  });
});

describe("audit : course avec une déconnexion et double échec de purge", () => {
  it("logout livré pendant la lecture du marqueur : aucune requête restaurée, aucun compte actif", async () => {
    await onlineSession(7);
    let release!: () => void;
    idb.gate = new Promise<void>((resolve) => (release = resolve));
    const client = coldStart();
    const pending = resumeOfflineRead(client, T0 + 1000);
    await tick(5);
    // Autre onglet : déconnexion, pendant que le marqueur est déjà lu en mémoire.
    onSessionChannelMessage(client, { type: "logout" });
    await tick(5);
    release();
    expect(await pending).toBeNull();
    expect(getActiveOfflineUserId()).toBeNull();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("purge complète : purgeOfflineSession renvoie vrai", async () => {
    await onlineSession(7);
    expect(await purgeOfflineSession(new QueryClient(), { broadcast: false })).toBe(true);
  });

  it("marqueur impossible à supprimer ET pierre impossible à poser : purge incomplète (faux)", async () => {
    await onlineSession(7);
    idb.failDelOf = RESUME_DB;
    fakeWindow.localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      expect(await purgeOfflineSession(new QueryClient(), { broadcast: false })).toBe(false);
    } finally {
      fakeWindow.localStorage.setItem = (k: string, v: string) => void lsData.set(k, v);
    }
  });
});

describe("audit : seules les réponses de session prolongent la reprise", () => {
  it("clés qui prouvent un contact : drapeaux et /api/auth/me, rien d'autre", () => {
    expect(isContactProof([FLAGS])).toBe(true);
    expect(isContactProof(["/api/auth/me"])).toBe(true);
    expect(isContactProof([ME])).toBe(false);
    expect(isContactProof(["/api/missions"])).toBe(false);
  });
});
