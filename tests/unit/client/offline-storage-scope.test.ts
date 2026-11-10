import { beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_MAX_AGE_MS,
  LEGACY_RECORD_KEYS,
  OFFLINE_DB_REGISTRY_KEY,
  createDbRegistry,
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

  it("changement de compte sans déconnexion : le cache de lecture des autres est supprimé, leur file est gardée", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(11, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    await scope.writeQueue(11, [{ id: "a" }], scope.epochOf(11));
    await scope.saveCache(22, [myWorkOrders({ id: 70, vehicleId: 15 })]);

    expect(await scope.purgeOthers(22)).toBe(1);

    // Tablette partagée : les saisies hors ligne du technicien 11 survivent à la connexion de 22.
    expect(await scope.loadCache(11)).toEqual([]);
    expect(await scope.readQueue(11)).toEqual([{ id: "a" }]);
    // Le compte 22 ne peut pas lire la file de 11 (contrôle du userId).
    expect(await scope.readQueue(22)).toEqual([]);
    expect((await scope.loadCache(22)).length).toBe(1);
  });

  it("changement de compte avec dropQueues : la file des autres comptes est détruite et comptée (S1)", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.writeQueue(11, [{ id: "a" }, { id: "b" }], scope.epochOf(11));
    await scope.saveCache(22, [myWorkOrders({ id: 70, vehicleId: 15 })]);

    await scope.purgeOthers(22, { dropQueues: true });

    expect(await scope.readQueue(11)).toEqual([]);
    expect((await scope.loadCache(22)).length).toBe(1);
  });

  it("déconnexion avec dropOtherQueues : la file de tous les comptes est détruite (S1)", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.writeQueue(11, [{ id: "a" }], scope.epochOf(11));
    await scope.writeQueue(22, [{ id: "c" }], scope.epochOf(22));

    await scope.purgeAll(11, { dropOtherQueues: true });

    expect(await scope.readQueue(11)).toEqual([]);
    expect(await scope.readQueue(22)).toEqual([]);
  });

  it("queuedCount compte les envois du compte sans toucher aux autres", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.writeQueue(11, [{ id: "a" }, { id: "b" }], scope.epochOf(11));
    await scope.writeQueue(22, [{ id: "c" }], scope.epochOf(22));
    expect(await scope.queuedCount(11)).toBe(2);
    expect(await scope.queuedCount(22)).toBe(1);
  });

  it("déconnexion : file du compte sortant détruite et comptée, file des autres comptes gardée", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.writeQueue(11, [{ id: "a" }, { id: "b" }], scope.epochOf(11));
    await scope.writeQueue(22, [{ id: "c" }], scope.epochOf(22));
    await scope.saveCache(22, [myWorkOrders({ id: 70, vehicleId: 15 })]);

    expect(await scope.purgeAll(11)).toBe(2);
    expect(await scope.readQueue(11)).toEqual([]);
    expect(await scope.readQueue(22)).toEqual([{ id: "c" }]);
    expect(await scope.loadCache(22)).toEqual([]);
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

describe("registre des magasins (navigateur sans indexedDB.databases)", () => {
  const fakeStorage = () => {
    const map = new Map<string, string>();
    return { map, storage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) } };
  };

  it("retient chaque base une seule fois, et seulement les noms valides", () => {
    const { map, storage } = fakeStorage();
    const registry = createDbRegistry(() => storage);
    registry.add(offlineDbName(7));
    registry.add(offlineDbName(7));
    registry.add(offlineDbName(8));
    registry.add("keyval-store");
    expect(registry.list()).toEqual(["fleetos-offline-u7", "fleetos-offline-u8"]);
    expect(map.get(OFFLINE_DB_REGISTRY_KEY)).toBe(JSON.stringify(["fleetos-offline-u7", "fleetos-offline-u8"]));
  });

  it("tolère un stockage absent ou un contenu corrompu", () => {
    expect(createDbRegistry(() => null).list()).toEqual([]);
    const { map, storage } = fakeStorage();
    map.set(OFFLINE_DB_REGISTRY_KEY, "{pas du json");
    const registry = createDbRegistry(() => storage);
    expect(registry.list()).toEqual([]);
    registry.add(offlineDbName(3));
    expect(registry.list()).toEqual(["fleetos-offline-u3"]);
    map.set(OFFLINE_DB_REGISTRY_KEY, JSON.stringify(["x", 5, "fleetos-offline-u9"]));
    expect(registry.list()).toEqual(["fleetos-offline-u9"]);
  });

  it("la déconnexion atteint le magasin d'un autre compte connu seulement par le registre", async () => {
    const { kv, dbs } = memoryKv();
    const { storage } = fakeStorage();
    const registry = createDbRegistry(() => storage);
    // Ce navigateur ne sait pas énumérer ses bases : seul le registre les connaît.
    const registered: OfflineKv = {
      ...kv,
      set: (db, key, value) => {
        registry.add(db);
        return kv.set(db, key, value);
      },
      listDbs: async () => registry.list(),
    };
    const scope = createOfflineScope(registered);
    await scope.writeQueue(5, [{ label: "file de A" }], scope.epochOf(5));
    await scope.saveCache(5, [myWorkOrders({ id: 62, vehicleId: 13 })]);
    await scope.writeQueue(6, [{ label: "file de B" }], scope.epochOf(6));

    await scope.purgeAll(6);

    // Compte sortant (6) : tout vidé. Autre compte (5) : cache supprimé, file gardée.
    expect(Array.from(dbs.get("fleetos-offline-u6")!.values())).toEqual([]);
    expect(await scope.loadCache(5)).toEqual([]);
    expect(await scope.readQueue(5)).toEqual([{ label: "file de A" }]);
  });
});
