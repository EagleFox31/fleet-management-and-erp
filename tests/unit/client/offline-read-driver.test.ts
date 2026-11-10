import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createOfflineScope,
  projectDriverMe,
  selectPersistableQueries,
  type CachedQueryLike,
  type OfflineKv,
} from "@/lib/offline-user-scope";
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

  it("garde ses missions en cours ou livrées, avec leurs sous-ressources et le solde", () => {
    const picked = selectPersistableQueries(
      [
        ...base,
        detail(1, "in_progress"),
        query(["/api/missions/1/fuel-records"], { missionId: 1, missionStatus: "in_progress", records: [] }),
        query(["/api/missions/1/launch-readiness"], { ready: true }),
        query(["/api/missions/2/pod-files"], { files: [] }),
        query(["/api/fuel-card/balance"], { balance: 100 }),
      ],
      flagsOn,
    );
    expect(keysOf(picked)).toEqual([
      ME,
      "/api/missions/1",
      "/api/missions/1/fuel-records",
      "/api/missions/1/launch-readiness",
      "/api/missions/2/pod-files",
      "/api/fuel-card/balance",
    ]);
  });

  it("refuse la mission d'un autre chauffeur, même avec un identifiant plausible", () => {
    const picked = selectPersistableQueries(
      [...base, detail(1, "in_progress", 99), detail(9, "in_progress"), query(["/api/missions/9/pod-files"], { files: [] })],
      flagsOn,
    );
    expect(keysOf(picked)).toEqual([ME]);
  });

  it("refuse une mission hors in_progress/delivered, dans /me comme dans le détail", () => {
    const picked = selectPersistableQueries(
      [
        ...base,
        detail(3, "assigned"),
        detail(4, "completed"),
        detail(1, "completed"),
        query(["/api/missions/2/fuel-records"], { missionId: 2, missionStatus: "completed", records: [] }),
        query(["/api/missions/3/launch-readiness"], { ready: false }),
      ],
      flagsOn,
    );
    expect(keysOf(picked)).toEqual([ME]);
    const me = picked[0]!.state.data as { missions: Array<{ id: number }> };
    expect(me.missions.map((m) => m.id)).toEqual([1, 2]);
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
    const orphans = [detail(1, "in_progress"), query(["/api/fuel-card/balance"], { balance: 1 })];
    expect(selectPersistableQueries(orphans, flagsOn)).toEqual([]);
    expect(selectPersistableQueries([query([ME], { driver: null, missions: [] }), ...orphans], flagsOn)).toEqual([]);
    expect(selectPersistableQueries([query([ME], { driver: driverRow, missions: [] }, "error"), ...orphans], flagsOn)).toEqual([]);
    expect(projectDriverMe({ driver: { id: 0 }, missions: [] })).toBeNull();
  });

  it("drapeaux éteints : aucune requête chauffeur retenue", () => {
    const all = [...base, detail(1, "in_progress")];
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
  const driverQueries = [meOf([{ id: 1, status: "in_progress" }]), detail(1, "in_progress")];

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
  const SECRETS = [
    "podUrl", "workflowData", "validatedBy", "email", "fuelBudget", "roadExpensesBudget", "contingencyBudget",
    "budgets", "budgetSuggestion", "fuel", "amount", "unitPrice", "totalAmount", "balance", "fuelBalance",
    "totalCredits", "totalDebits", "lastCredit", "lastDebit", "uploadedByName", "detail", "cniNumber", "licenseNumber",
  ];
  const fat = (extra: Record<string, unknown> = {}) => ({
    id: 11, status: "in_progress", orderNumber: "M-11", cargo: "ciment", assignments: [{ driverId: 7, id: 1, secret: "x", vehicle: { id: 2, registrationNumber: "LT-1", vin: "VIN" } }],
    assignment: { driverId: 7, notes: "n" }, client: { name: "ACME", phone: "6", email: "a@b.c", contactPerson: "Bob", taxId: "T" },
    podUrl: "/x", workflowData: { a: 1 }, validatedBy: 3, fuelBudget: 10, budgets: { a: 1 }, driver: { cniNumber: "C" }, ...extra,
  });

  it("une enveloppe persistée ne contient aucune clé hors liste blanche (récursif)", () => {
    const qs = [
      meOf([{ id: 11, status: "in_progress" }]),
      query(["/api/missions/11"], fat()),
      query(["/api/missions/11/fuel-records"], {
        missionId: 11, missionStatus: "in_progress", totalQuantity: 5, totalAmount: 9,
        records: [{ id: 1, date: "d", quantity: 5, mileage: 100, stationName: "S", amount: 9, unitPrice: 2, paymentMode: "cash" }],
      }),
      query(["/api/missions/11/launch-readiness"], {
        missionId: 11, missionStatus: "in_progress", canLaunch: true, summary: { total: 1, passed: 1, failed: 0, warnings: 0 },
        checks: [{ key: "budget_fuel", label: "Budget", passed: true, blocking: true, detail: "500 FCFA" }],
        fuel: { balance: 1 }, budgets: { fuelBudget: 1 }, budgetSuggestion: { a: 1 },
      }),
      query(["/api/missions/11/pod-files"], { files: [{ id: 1, originalName: "a.jpg", mime: "image/jpeg", sizeBytes: 3, uploadedAt: "t", uploadedByName: "Moi" }] }),
      query(["/api/fuel-card/balance"], { balance: 99, fuelBalance: 3, totalCredits: 1, totalDebits: 1, lastCredit: { a: 1 }, averagePricePerLiter: 700, priceSource: "real" }),
    ];
    const persisted = selectPersistableQueries(qs, flagsOn);
    expect(persisted).toHaveLength(6);
    const keys = collectKeys(persisted.map((q) => q.state.data));
    const names = [...keys].map((k) => k.split(".").pop()!);
    for (const secret of SECRETS) expect(names, secret).not.toContain(secret);
    expect([...keys].sort()).toMatchSnapshot();
  });

  it("le détail garde le contact sur place et les points A/B, sans e-mail client", () => {
    const [, d] = selectPersistableQueries([meOf([{ id: 11, status: "in_progress" }]), query(["/api/missions/11"], fat({ pickupLat: 1, pickupLng: 2 }))], flagsOn);
    const data = d!.state.data as Record<string, any>;
    expect(data.client).toEqual({ name: "ACME", phone: "6", contactPerson: "Bob" });
    expect(data.pickupLat).toBe(1);
    expect(data.cargo).toBe("ciment");
  });
});
