import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_MS,
  LEGACY_RECORD_KEYS,
  createOfflineScope,
  getActiveOfflineUserId,
  isOfflineDbName,
  offlineDbName,
  selectPersistableQueries,
  setActiveOfflineUserId,
  subscribeActiveOfflineUser,
  type CachedQueryLike,
  type OfflineKv,
} from "@/lib/offline-user-scope";

/** Stockage mémoire : une base par nom, valeurs clonées comme IndexedDB le fait. */
function memoryKv() {
  const dbs = new Map<string, Map<string, unknown>>();
  const legacy = new Map<string, unknown>();
  const hooks: { beforeSet?: (db: string) => Promise<void> } = {};
  const kv: OfflineKv = {
    async get<T>(db: string, key: string) {
      const value = dbs.get(db)?.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    async set(db, key, value) {
      await hooks.beforeSet?.(db);
      if (!dbs.has(db)) dbs.set(db, new Map());
      dbs.get(db)!.set(key, structuredClone(value));
    },
    async del(db, key) {
      dbs.get(db)?.delete(key);
    },
    async clearDb(db) {
      dbs.get(db)?.clear();
    },
    async listDbs() {
      return Array.from(dbs.keys());
    },
    async delLegacy(key) {
      legacy.delete(key);
    },
  };
  /** Toute valeur encore stockée, bases et ancien format confondus. */
  const dump = () => ({
    dbs: Array.from(dbs.entries()).flatMap(([db, records]) =>
      Array.from(records.entries()).map(([key, value]) => ({ db, key, value })),
    ),
    legacy: Array.from(legacy.entries()),
  });
  return { kv, dbs, legacy, hooks, dump };
}

const query = (queryKey: unknown[], data: unknown, status = "success"): CachedQueryLike => ({
  queryKey,
  state: { data, status, dataUpdatedAt: 1_000 },
});

const MY_WO = "/api/technician/my-work-orders";
const myWorkOrders = (...orders: Array<{ id: number; vehicleId: number }>) =>
  query([MY_WO], { workOrders: orders, total: orders.length });

beforeEach(() => {
  setActiveOfflineUserId(null);
});

describe("noms de magasin", () => {
  it("une base par utilisateur, identifiant validé", () => {
    expect(offlineDbName(7)).toBe("fleetos-offline-u7");
    expect(offlineDbName(7)).not.toBe(offlineDbName(8));
    expect(() => offlineDbName(0)).toThrow();
    expect(() => offlineDbName(1.5)).toThrow();
    expect(isOfflineDbName("fleetos-offline-u12")).toBe(true);
    expect(isOfflineDbName("keyval-store")).toBe(false);
    expect(isOfflineDbName("fleetos-offline-u12; drop")).toBe(false);
  });
});

describe("liste blanche des requêtes persistées", () => {
  it("garde mes OT, et pour ces OT seulement le détail, les pièces et le véhicule", () => {
    const kept = [
      myWorkOrders({ id: 62, vehicleId: 13 }, { id: 63, vehicleId: 14 }),
      query(["/api/work-orders/62"], { id: 62 }),
      query(["/api/work-orders/62/parts"], []),
      query(["/api/work-orders/63/pending-part-requirements"], []),
      query(["/api/work-orders/62/items"], []),
      query(["/api/vehicles/13"], { id: 13 }),
      query(["/api/vehicles/14"], { id: 14 }),
    ];
    const excluded = [
      query(["/api/work-orders/99"], { id: 99 }), // OT d'un autre technicien
      query(["/api/work-orders/99/parts"], []),
      query(["/api/vehicles/50"], { id: 50 }), // véhicule hors de mes OT
      query(["/api/vehicles"], []), // parc complet
      query(["/api/parts"], []), // catalogue complet
      query(["/api/parts", { limit: 1000 }], []),
      query(["/api/work-orders"], []), // liste de tous les OT
      query(["/api/work-orders/statistics"], {}),
      query(["/api/work-orders/62/tire-rotations"], []),
      query(["/api/vehicles/13/status-history"], []),
      query(["/api/users/technicians"], []),
      query(["/api/supplier-invoices"], []),
      query(["/api/client-invoices", { id: 3 }], []),
      query([`/api/work-orders/62`, { limit: 5 }], {}), // avec paramètres
      query(["/api/work-orders/62/notes"], {}),
    ];
    const selected = selectPersistableQueries([...excluded, ...kept]);
    expect(selected.map((q) => q.queryKey[0]).sort()).toEqual(kept.map((q) => q.queryKey[0]).sort());
  });

  it("ne retient rien sans la liste de mes OT, ou si elle est en erreur", () => {
    expect(selectPersistableQueries([query(["/api/work-orders/62"], { id: 62 })])).toEqual([]);
    expect(
      selectPersistableQueries([
        query([MY_WO], undefined, "pending"),
        query(["/api/work-orders/62"], { id: 62 }),
      ]),
    ).toEqual([]);
    expect(selectPersistableQueries([query([MY_WO], { workOrders: [] }, "error")])).toEqual([]);
  });

  it("écarte une requête en erreur ou sans donnée", () => {
    const selected = selectPersistableQueries([
      myWorkOrders({ id: 62, vehicleId: 13 }),
      query(["/api/work-orders/62"], undefined),
      query(["/api/vehicles/13"], { id: 13 }, "error"),
    ]);
    expect(selected.map((q) => q.queryKey[0])).toEqual([MY_WO]);
  });
});

describe("cloison entre deux comptes sur le même appareil", () => {
  it("A déconnecté, B ne lit rien de A (cache, file, ancien format global)", async () => {
    const { kv, dump, legacy } = memoryKv();
    const scope = createOfflineScope(kv);
    const A = 11;
    const B = 22;

    // A travaille hors ligne : cache + file d'écritures
    await scope.saveCache(A, [myWorkOrders({ id: 62, vehicleId: 13 }), query(["/api/vehicles/13"], { plate: "A-SECRET" })]);
    await scope.writeQueue(A, [{ id: "offline-1", label: "relevé A" }], scope.epochOf(A));
    legacy.set(LEGACY_RECORD_KEYS[0], { owner: "inconnu" });
    expect(dump().dbs.length).toBeGreaterThan(0);

    // Déconnexion de A, connexion de B
    setActiveOfflineUserId(A);
    await scope.purgeAll(A);
    setActiveOfflineUserId(B);

    expect(await scope.loadCache(B)).toEqual([]);
    expect(await scope.readQueue(B)).toEqual([]);
    // Rien de A ne subsiste nulle part dans le stockage
    expect(JSON.stringify(dump())).not.toContain("A-SECRET");
    expect(JSON.stringify(dump())).not.toContain("relevé A");
    expect(dump().dbs).toEqual([]);
    expect(dump().legacy).toEqual([]);
  });

  it("B ne lit jamais le magasin de A, même si A n'a pas été purgé", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    await scope.writeQueue(11, [{ id: "x" }], scope.epochOf(11));

    expect(await scope.loadCache(22)).toEqual([]);
    expect(await scope.readQueue(22)).toEqual([]);
  });

  it("refuse une enveloppe qui nomme un autre propriétaire que le magasin", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    // Copie d'un magasin à l'autre (par exemple une base restaurée à la main)
    dbs.set(offlineDbName(22), new Map(dbs.get(offlineDbName(11))!));

    expect(await scope.loadCache(22)).toEqual([]);
    expect(await scope.readQueue(22)).toEqual([]);
  });

  it("changement de compte sans déconnexion : les magasins des autres sont vidés, le sien reste", async () => {
    const { kv, dump } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    await scope.writeQueue(11, [{ id: "a" }], scope.epochOf(11));
    await scope.saveCache(22, [myWorkOrders({ id: 70, vehicleId: 15 })]);

    expect(await scope.purgeOthers(22)).toBe(1);

    expect(await scope.loadCache(11)).toEqual([]);
    expect(await scope.readQueue(11)).toEqual([]);
    expect((await scope.loadCache(22)).length).toBe(1);
    expect(dump().dbs.every((r) => r.db === offlineDbName(22))).toBe(true);
  });

  it("une sauvegarde en cours pendant la déconnexion ne ressuscite pas le magasin", async () => {
    const { kv, hooks, dump } = memoryKv();
    const scope = createOfflineScope(kv);
    let release!: () => void;
    hooks.beforeSet = () => new Promise<void>((resolve) => (release = resolve));

    const saving = scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    // La déconnexion intervient alors que l'écriture n'a pas encore abouti
    hooks.beforeSet = undefined;
    await scope.purgeAll(11);
    release();
    await saving;

    expect(dump().dbs.flatMap((r) => (r.value === undefined ? [] : [r]))).toEqual([]);
    expect(await scope.loadCache(11)).toEqual([]);
  });

  it("un rejeu de file en cours pendant la déconnexion ne réécrit pas la file", async () => {
    const { kv, dump } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.writeQueue(11, [{ id: "a" }], scope.epochOf(11));
    const startedAt = scope.epochOf(11);
    await scope.purgeAll(11);

    expect(await scope.writeQueue(11, [{ id: "a" }], startedAt)).toBe(false);
    expect(dump().dbs).toEqual([]);
  });

  it("ne remplace pas une copie existante par du vide (cache pas encore rempli)", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    await scope.saveCache(11, []);
    expect((await scope.loadCache(11)).length).toBe(1);
  });
});

describe("lecture du cache persisté", () => {
  it("jette une copie de plus de 7 jours", async () => {
    const { kv, dump } = memoryKv();
    const scope = createOfflineScope(kv);
    const t0 = 1_000_000;
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })], t0);

    expect((await scope.loadCache(11, t0 + CACHE_MAX_AGE_MS)).length).toBe(1);
    expect(await scope.loadCache(11, t0 + CACHE_MAX_AGE_MS + 1)).toEqual([]);
    expect(dump().dbs).toEqual([]);
  });

  it("applique la liste blanche aussi aux copies déjà écrites", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    dbs.set(
      offlineDbName(11),
      new Map<string, unknown>([
        [
          "query-cache",
          {
            version: 2,
            userId: 11,
            timestamp: Date.now(),
            queries: [
              { queryKey: [MY_WO], state: { data: { workOrders: [{ id: 62, vehicleId: 13 }] } } },
              { queryKey: ["/api/parts"], state: { data: [{ id: 1 }] } },
            ],
          },
        ],
      ]),
    );

    const loaded = await scope.loadCache(11);
    expect(loaded.map((q) => q.queryKey[0])).toEqual([MY_WO]);
  });

  it("ignore une copie d'une autre version du format", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    dbs.set(
      offlineDbName(11),
      new Map<string, unknown>([["query-cache", { version: 1, userId: 11, timestamp: Date.now(), queries: [] }]]),
    );
    expect(await scope.loadCache(11)).toEqual([]);
  });
});

describe("utilisateur actif", () => {
  it("notifie les abonnés seulement quand l'utilisateur change", () => {
    const seen: Array<[number | null, number | null]> = [];
    const unsubscribe = subscribeActiveOfflineUser((id, previous) => seen.push([id, previous]));

    setActiveOfflineUserId(5);
    setActiveOfflineUserId(5);
    setActiveOfflineUserId(null);
    unsubscribe();
    setActiveOfflineUserId(6);

    expect(seen).toEqual([
      [5, null],
      [null, 5],
    ]);
    expect(getActiveOfflineUserId()).toBe(6);
  });
});

/** Évalue le vrai `client/public/sw.js` dans un contexte simulé. */
function loadServiceWorker() {
  type Handler = (event: Record<string, unknown>) => void;
  const handlers = new Map<string, Handler>();
  const caches = new Map<string, Map<string, unknown>>();
  const calls = { cachePut: [] as string[], cachesOpen: [] as string[], fetched: [] as string[] };

  const cacheOf = (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const store = caches.get(name)!;
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(new URL(u, "https://app.test").href, "static")),
      put: async (request: { url: string }, response: unknown) => {
        calls.cachePut.push(`${name}|${new URL(request.url).pathname}`);
        store.set(request.url, response);
      },
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (request: { url: string }) => store.delete(request.url),
    };
  };

  const context = {
    URL,
    console,
    Promise,
    self: {
      addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
      location: { origin: "https://app.test" },
    },
    caches: {
      open: async (name: string) => {
        calls.cachesOpen.push(name);
        return cacheOf(name);
      },
      keys: async () => Array.from(caches.keys()),
      delete: async (name: string) => caches.delete(name),
      match: async (request: { url: string }) => {
        for (const store of caches.values()) if (store.has(request.url)) return store.get(request.url);
        return undefined;
      },
    },
    fetch: async (request: { url: string }) => {
      calls.fetched.push(request.url);
      return { status: 200, clone() { return this; } };
    },
  };
  vm.runInNewContext(readFileSync(path.resolve("client/public/sw.js"), "utf8"), context);

  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded = false;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
      respondWith: (p: Promise<unknown>) => {
        responded = true;
        waits.push(p);
      },
    };
    handlers.get(type)!(event);
    await Promise.all(waits);
    return { responded };
  };
  return { caches, calls, dispatch };
}

describe("service worker : aucune réponse /api/* en Cache Storage", () => {
  const getRequest = (pathname: string) => ({
    url: `https://app.test${pathname}`,
    method: "GET",
    mode: "cors",
  });

  it("n'intercepte pas un GET /api/* et n'écrit rien dans le cache", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");
    sw.calls.cachePut.length = 0;
    sw.calls.cachesOpen.length = 0;

    const result = await sw.dispatch("fetch", { request: getRequest("/api/technician/my-work-orders") });

    expect(result.responded).toBe(false);
    expect(sw.calls.cachePut).toEqual([]);
    expect(sw.calls.cachesOpen).toEqual([]);
    expect(sw.calls.fetched).toEqual([]);
  });

  it("garde le cache des assets statiques", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("install");

    const result = await sw.dispatch("fetch", { request: getRequest("/assets/index-abc.js") });
    await new Promise((resolve) => setTimeout(resolve, 0)); // l'écriture en cache n'est pas attendue par le worker

    expect(result.responded).toBe(true);
    expect(sw.calls.cachePut).toEqual(["fleetos-static-v2|/assets/index-abc.js"]);
  });

  it("à l'activation, supprime les anciens caches (réponses API comprises)", async () => {
    const sw = loadServiceWorker();
    // État d'un téléphone installé avant la mise à jour : cache v1 avec des réponses API
    sw.caches.set(
      "fleetos-tech-v1.0.0",
      new Map<string, unknown>([["https://app.test/api/technician/my-work-orders", { secret: "A" }]]),
    );
    // Et une entrée /api/* égarée dans le cache courant
    sw.caches.set(
      "fleetos-static-v2",
      new Map<string, unknown>([
        ["https://app.test/api/auth/me", { secret: "A" }],
        ["https://app.test/index.html", "static"],
      ]),
    );

    await sw.dispatch("activate");

    expect(Array.from(sw.caches.keys())).toEqual(["fleetos-static-v2"]);
    expect(Array.from(sw.caches.get("fleetos-static-v2")!.keys())).toEqual(["https://app.test/index.html"]);
  });
});
