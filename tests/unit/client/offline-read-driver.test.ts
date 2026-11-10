import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  createOfflineScope,
  CACHE_MAX_AGE_MS,
  DRIVER_CACHE_MAX_AGE_MS,
  QUEUE_RECORD_KEY,
  projectDriverMe,
  selectPersistableQueries,
  type CachedQueryLike,
  type OfflineKv,
} from "@/lib/offline-user-scope";
import { applyRestoredQueries } from "@/lib/offline-restore";
import {
  DRIVER_CACHE_SHAPES,
  DRIVER_ME_MISSION_SHAPE,
  shapeKeyPaths,
} from "@/lib/offline-driver-projection";
import { formatOfflineStamp, offlineBannerText } from "@/lib/offline-data-banner";
import { OfflineDataBannerView } from "@/components/offline/offline-data-banner";

// Le JSX de vitest utilise le runtime classique : React doit être global pour le rendu serveur.
(globalThis as unknown as { React: typeof React }).React = React;

const ME = "/api/drivers/me";
const flagsOn = () => true;
const query = (queryKey: unknown[], data: unknown, status = "success"): CachedQueryLike => ({
  queryKey,
  state: { data, status, dataUpdatedAt: 1_700_000_000_000 },
});

const driverRow = {
  id: 7,
  userId: 70,
  firstName: "Awa",
  lastName: "Ngono",
  employeeNumber: "E-77",
  birthDate: "1985-02-03",
  cniNumber: "CNI-SECRET",
  licenseNumber: "PERMIS-SECRET",
  licenseExpiry: "2027-01-01",
  cpcTrainingDate: "2024-01-01",
  cpcStatus: "FORME",
};
const meOf = (missions: Array<{ id: number; status: string }>) => query([ME], { driver: driverRow, missions });
const detail = (id: number, status: string, driverId = 7) =>
  query([`/api/missions/${id}`], { id, status, assignments: [{ driverId }], assignment: { driverId } });

const keysOf = (qs: CachedQueryLike[]) => qs.map((q) => q.queryKey[0]);

describe("lecture hors ligne du chauffeur : sélection", () => {
  const base = [
    meOf([
      { id: 1, status: "in_progress" },
      { id: 2, status: "delivered" },
      { id: 3, status: "assigned" },
      { id: 4, status: "completed" },
    ]),
  ];

  it("garde ses missions en cours ou livrées et le prix du litre, rien d'autre (cache <= écran)", () => {
    const picked = selectPersistableQueries(
      [
        ...base,
        detail(1, "in_progress"),
        query(["/api/missions/1/fuel-records"], { missionId: 1, missionStatus: "in_progress", records: [] }),
        query(["/api/missions/1/launch-readiness"], { ready: true }),
        query(["/api/missions/2/pod-files"], { files: [] }),
        query(["/api/fuel-card/balance"], { balance: 100, averagePricePerLiter: 700 }),
      ],
      flagsOn,
    );
    expect(keysOf(picked)).toEqual([ME, "/api/fuel-card/balance"]);
    const me = picked[0]!.state.data as { missions: Array<{ id: number }> };
    expect(me.missions.map((m) => m.id)).toEqual([1, 2]);
  });

  it("refuse une mission hors in_progress/delivered dans /me", () => {
    const me = selectPersistableQueries([...base], flagsOn)[0]!.state.data as { missions: Array<{ id: number; status: string }> };
    expect(me.missions.map((m) => m.status).sort()).toEqual(["delivered", "in_progress"]);
  });

  it("ne garde jamais la fiche personnelle du chauffeur (permis, CNI, naissance, CPC)", () => {
    const [me] = selectPersistableQueries([...base], flagsOn);
    expect(me!.state.data).toMatchObject({ driver: { id: 7, firstName: "Awa", lastName: "Ngono" } });
    const text = JSON.stringify(me!.state.data);
    for (const secret of ["CNI-SECRET", "PERMIS-SECRET", "1985", "licenseExpiry", "cpcTrainingDate", "employeeNumber"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("exclut documents personnels, pièces jointes, fichiers POD eux-mêmes et endpoints hors liste", () => {
    const picked = selectPersistableQueries(
      [
        ...base,
        query(["/api/drivers/7"], driverRow),
        query(["/api/drivers/7/documents"], []),
        query(["/api/missions/1/pod-files/12"], {}),
        query(["/api/missions/1/documents"], []),
        query(["/api/missions"], []),
        query(["/api/fuel-card/history"], []),
        query(["/api/vehicles/3"], { id: 3 }),
        query(["/api/missions/1", { foo: 1 }], {}),
      ],
      flagsOn,
    );
    expect(keysOf(picked)).toEqual([ME]);
  });

  it("ne retient rien sans l'ancre /api/drivers/me valide (doute : ne pas persister)", () => {
    const orphans = [query(["/api/fuel-card/balance"], { averagePricePerLiter: 1 })];
    expect(selectPersistableQueries(orphans, flagsOn)).toEqual([]);
    expect(selectPersistableQueries([query([ME], { driver: null, missions: [] }), ...orphans], flagsOn)).toEqual([]);
    expect(selectPersistableQueries([query([ME], { driver: driverRow, missions: [] }, "error"), ...orphans], flagsOn)).toEqual([]);
    expect(projectDriverMe({ driver: { id: 0 }, missions: [] })).toBeNull();
  });

  it("drapeaux éteints : aucune requête chauffeur retenue", () => {
    const all = [...base, query(["/api/fuel-card/balance"], { averagePricePerLiter: 1 })];
    expect(selectPersistableQueries(all)).toEqual([]);
    expect(selectPersistableQueries(all, (f) => f === "driver-offline")).toEqual([]);
    expect(selectPersistableQueries(all, (f) => f === "offline-writes")).toEqual([]);
  });

  it("le profil technicien reste actif sans drapeau et n'attrape rien du chauffeur", () => {
    const mine = query(["/api/technician/my-work-orders"], [{ id: 5, vehicleId: 3 }]);
    expect(keysOf(selectPersistableQueries([mine, ...base]))).toEqual(["/api/technician/my-work-orders"]);
  });
});

function memoryKv() {
  const dbs = new Map<string, Map<string, unknown>>();
  const kv: OfflineKv = {
    async get<T>(db: string, key: string) {
      const v = dbs.get(db)?.get(key);
      return v === undefined ? undefined : (structuredClone(v) as T);
    },
    async set(db, key, value) {
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
    async delLegacy() {},
  };
  return { kv, dbs };
}

describe("lecture hors ligne du chauffeur : cloison par compte", () => {
  const driverQueries = [meOf([{ id: 1, status: "in_progress" }]), query(["/api/fuel-card/balance"], { averagePricePerLiter: 700 })];

  it("le second compte du même appareil ne lit rien du premier", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    expect(await scope.saveCache(10, driverQueries, 1_000, flagsOn)).toBe(2);
    expect((await scope.loadCache(10, 2_000, flagsOn)).length).toBe(2);
    expect(await scope.loadCache(11, 2_000, flagsOn)).toEqual([]);
  });

  it("l'enveloppe d'un compte copiée sous un autre est refusée", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    dbs.set("fleetos-offline-u11", new Map(dbs.get("fleetos-offline-u10")!));
    expect(await scope.loadCache(11, 2_000, flagsOn)).toEqual([]);
  });

  it("le changement de compte et la déconnexion purgent le cache chauffeur", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    await scope.saveCache(11, driverQueries, 1_000, flagsOn);
    await scope.purgeOthers(11);
    expect(await scope.loadCache(10, 2_000, flagsOn)).toEqual([]);
    expect((await scope.loadCache(11, 2_000, flagsOn)).length).toBe(2);
    await scope.purgeAll(11);
    expect(await scope.loadCache(11, 2_000, flagsOn)).toEqual([]);
    expect(Array.from(dbs.values()).every((records) => records.size === 0)).toBe(true);
  });

  it("n'écrit rien du chauffeur drapeaux éteints, et relit filtré après extinction", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    expect(await scope.saveCache(10, driverQueries, 1_000)).toBe(0);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    expect(await scope.loadCache(10, 2_000, () => false)).toEqual([]);
  });

  it("l'horodatage de la lecture réussie traverse la persistance", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    const [me] = await scope.loadCache(10, 2_000, flagsOn);
    expect(me!.state.dataUpdatedAt).toBe(1_700_000_000_000);
  });
});

describe("lecture hors ligne du chauffeur : extinction, session expirée, âge", () => {
  const driverQueries = [meOf([{ id: 1, status: "in_progress" }]), query(["/api/fuel-card/balance"], { averagePricePerLiter: 700 })];
  const queueOf = (userId: number) => ({ version: 2, userId, actions: [{ id: "a" }] });

  it("drapeaux connus et éteints : la copie de lecture est supprimée à la réécriture", async () => {
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    expect((await scope.loadCache(10, 2_000, flagsOn)).length).toBe(2);
    // Sans l'option, une réécriture vide ne touche pas à la copie existante.
    await scope.saveCache(10, driverQueries, 1_500, () => false);
    expect((await scope.loadCache(10, 2_000, flagsOn)).length).toBe(2);
    await scope.saveCache(10, driverQueries, 1_600, () => false, { dropIfEmpty: true });
    expect(await scope.loadCache(10, 2_000, flagsOn)).toEqual([]);
  });

  it("session expirée : le cache de lecture part, la file d'envois reste", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 1_000, flagsOn);
    await kv.set("fleetos-offline-u10", QUEUE_RECORD_KEY, queueOf(10));
    await scope.dropUserReadCache(10);
    expect(await scope.loadCache(10, 2_000, flagsOn)).toEqual([]);
    expect(dbs.get("fleetos-offline-u10")!.get(QUEUE_RECORD_KEY)).toEqual(queueOf(10));
    expect(await scope.readQueue(10)).toHaveLength(1);
  });

  it("une sauvegarde en cours au moment de l'expiration ne ressuscite pas le cache et garde la file", async () => {
    const { kv, dbs } = memoryKv();
    const scope = createOfflineScope(kv);
    await kv.set("fleetos-offline-u10", QUEUE_RECORD_KEY, queueOf(10));
    const realSet = kv.set.bind(kv);
    kv.set = async (db, key, value) => {
      await realSet(db, key, value);
      if (key === "query-cache") await scope.dropUserReadCache(10);
    };
    expect(await scope.saveCache(10, driverQueries, 1_000, flagsOn)).toBe(0);
    expect(dbs.get("fleetos-offline-u10")!.has("query-cache")).toBe(false);
    expect(dbs.get("fleetos-offline-u10")!.get(QUEUE_RECORD_KEY)).toEqual(queueOf(10));
  });

  it("le cache du chauffeur expire après 72 h, celui des autres profils garde 7 jours", async () => {
    expect(DRIVER_CACHE_MAX_AGE_MS).toBe(72 * 3600 * 1000);
    const h = 3600 * 1000;
    const { kv } = memoryKv();
    const scope = createOfflineScope(kv);
    await scope.saveCache(10, driverQueries, 0, flagsOn);
    expect((await scope.loadCache(10, 72 * h, flagsOn)).length).toBe(2);
    expect(await scope.loadCache(10, 72 * h + 1, flagsOn)).toEqual([]);
    const tech = [query(["/api/technician/my-work-orders"], [{ id: 5, vehicleId: 3 }])];
    await scope.saveCache(11, tech, 0);
    expect((await scope.loadCache(11, 100 * h)).length).toBe(1);
    expect(await scope.loadCache(11, CACHE_MAX_AGE_MS + 1)).toEqual([]);
  });
});

describe("bandeau hors ligne", () => {
  const stamp = new Date(2026, 10, 10, 14, 5).getTime();

  it("affiche la date et l'heure de la dernière lecture réussie", () => {
    expect(formatOfflineStamp(stamp)).toBe("10/11/2026 à 14:05");
    expect(offlineBannerText({ online: false, updatedAt: stamp })).toBe("Hors ligne, données du 10/11/2026 à 14:05");
  });

  it("est absent en ligne ou sans horodatage", () => {
    expect(offlineBannerText({ online: true, updatedAt: stamp })).toBeNull();
    expect(offlineBannerText({ online: false, updatedAt: 0 })).toBeNull();
    expect(offlineBannerText({ online: false, updatedAt: undefined })).toBeNull();
  });

  it("le composant rend le texte et rien sans texte", () => {
    const html = renderToStaticMarkup(
      React.createElement(OfflineDataBannerView, { text: offlineBannerText({ online: false, updatedAt: stamp }) }),
    );
    expect(html).toContain("Hors ligne, données du 10/11/2026 à 14:05");
    expect(html).toContain('role="status"');
    expect(renderToStaticMarkup(React.createElement(OfflineDataBannerView, { text: null }))).toBe("");
  });
});

describe("lecture hors ligne du chauffeur : liste blanche de champs", () => {
  const collectKeys = (value: unknown, prefix = "", out = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach((v) => collectKeys(v, prefix + "[]", out));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        out.add(`${prefix}.${k}`);
        collectKeys(v, `${prefix}.${k}`, out);
      }
    }
    return out;
  };
  const FORBIDDEN = [
    "podUrl", "workflowData", "validatedBy", "email", "fuelBudget", "roadExpensesBudget", "contingencyBudget", "budgets",
    "budgetSuggestion", "amount", "unitPrice", "totalAmount", "balance", "fuelBalance", "totalCredits", "totalDebits",
    "lastCredit", "lastDebit", "cniNumber", "licenseNumber", "contactPerson", "phone", "contact", "telephone",
    "missionType", "actualFuelCost", "cargo", "client", "assignment", "assignments",
  ];

  it("l'instantané des clés vient des formes elles-mêmes, pas d'une fixture", () => {
    const paths = Object.entries(DRIVER_CACHE_SHAPES).flatMap(([route, shape]) => shapeKeyPaths(shape).map((k) => `${route} ${k}`));
    expect(paths).toMatchSnapshot();
    const names = paths.map((k) => k.split(".").pop()!);
    for (const f of FORBIDDEN) expect(names, f).not.toContain(f);
  });

  it("une enveloppe persistée n'a aucune clé hors des formes, même chargée de champs en trop (mutation)", () => {
    const fatMission = {
      id: 11, status: "in_progress", orderNumber: "M-11", pickupAddress: "A", clientName: "ACME", vehicleRegistration: "LT-1",
      missionType: "export", actualFuelCost: 12, cargo: { description: "ciment" }, podUrl: "/x", workflowData: { a: 1 },
      client: { name: "ACME", email: "a@b.c", phone: "6" }, assignment: { driverId: 7 }, fuelBudget: 10,
    };
    const me = query([ME], { driver: { ...driverRow, extra: 1 }, missions: [fatMission] });
    const balance = query(["/api/fuel-card/balance"], {
      balance: 99, fuelBalance: 3, totalCredits: 1, lastCredit: { a: 1 }, averagePricePerLiter: 700, priceSource: "real", missionType: "x",
    });
    const persisted = selectPersistableQueries([me, balance], flagsOn);
    expect(persisted).toHaveLength(2);
    for (const q of persisted) {
      const allowed = new Set(shapeKeyPaths(DRIVER_CACHE_SHAPES[q.queryKey[0] as string]!));
      const got = [...collectKeys(q.state.data)];
      expect(got.filter((k) => !allowed.has(k)), String(q.queryKey[0])).toEqual([]);
    }
    const text = JSON.stringify(persisted.map((q) => q.state.data));
    for (const f of ["missionType", "actualFuelCost", "podUrl", "workflowData", "fuelBudget", "a@b.c", "cargo"]) expect(text).not.toContain(f);
  });

  it("une clé ajoutée à une forme change l'instantané (la liste se relit à ce moment)", () => {
    const widened = { ...(DRIVER_ME_MISSION_SHAPE as Record<string, unknown>), missionType: true } as typeof DRIVER_ME_MISSION_SHAPE;
    expect(shapeKeyPaths(widened)).toContain(".missionType");
    expect(shapeKeyPaths(DRIVER_ME_MISSION_SHAPE)).not.toContain(".missionType");
  });
});

describe("restauration du cache hors ligne", () => {
  it("une copie restaurée est marquée périmée et ne remplace pas une donnée déjà en mémoire", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["/api/fuel-card/balance"], { fresh: true });
    const items = [
      { queryKey: [ME], state: { data: { driver: { id: 7 }, missions: [] }, dataUpdatedAt: 1_000 } },
      { queryKey: ["/api/fuel-card/balance"], state: { data: { old: true }, dataUpdatedAt: 1_000 } },
    ];
    expect(applyRestoredQueries(qc, items)).toBe(1);
    expect(qc.getQueryData(["/api/fuel-card/balance"])).toEqual({ fresh: true });
    expect(qc.getQueryData([ME])).toEqual({ driver: { id: 7 }, missions: [] });
    expect(qc.getQueryState([ME])!.isInvalidated).toBe(true);
    expect(qc.getQueryState([ME])!.dataUpdatedAt).toBe(1_000);
    expect(qc.getQueryState(["/api/fuel-card/balance"])!.isInvalidated).toBe(false);
  });
});

