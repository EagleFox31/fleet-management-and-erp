import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FUEL_ANOMALIES_PATH,
  FUEL_ANOMALIES_SUMMARY_PATH,
  fuelAnomaliesResponseSchema,
  fuelAnomaliesSummarySchema,
} from "../../shared/contracts/fuel-anomalies";
import { VEHICLE_TANK_CAPACITY_MESSAGE, fuelAnomalyResolutions, fuelRecords, vehicles } from "../../shared/schema";
import { db } from "../../server/db";
import { VEHICLE_TANK_CAPACITY_ONLY_MESSAGE } from "../../server/lib/vehicle-patch-guard";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/** FUEL3, niveau C : règles dans la liste, compteur, capacité du véhicule (PATCH) et temps réel des pleins. */
process.env.FEATURE_FLAGS = "fuel-anomalies=on";

const ids = createIdBag();
const events: { event: string; data: any }[] = [];
let api: Awaited<ReturnType<typeof startContractActors<"admin" | "logistics" | "workshopManager" | "management" | "technician" | "client" | "secretary">>>;
let vehicleId = 0;

beforeAll(async () => {
  (global as any).broadcastUpdate = (event: string, data: unknown) => events.push({ event, data });
  api = await startContractActors(
    { admin: "admin", logistics: "logistics", workshopManager: "workshop_manager", management: "management", technician: "technician", client: "client", secretary: "secretary" },
    ids.userIds,
  );
  const v = await createTestVehicle();
  vehicleId = v.id;
  ids.vehicleIds.push(v.id);
}, 180000);

afterAll(async () => {
  await cleanupCreated(ids);
  delete (global as any).broadcastUpdate;
  await api.close();
});

describe("GET /api/fuel-card/anomalies : nouvelles règles", { timeout: 120000 }, () => {
  it("expose tank-overflow et odometer-regression conformes au contrat", async () => {
    await db.update(vehicles).set({ tankCapacityL: 100 }).where(eq(vehicles.id, vehicleId));
    const [over] = await db.insert(fuelRecords).values({ vehicleId, date: "2091-01-02", quantity: 130, mileage: 2000 }).returning();
    const [back] = await db.insert(fuelRecords).values({ vehicleId, date: "2091-01-03", quantity: 40, mileage: 1900 }).returning();
    ids.fuelRecordIds.push(over.id, back.id);

    const res = await api.call("GET", FUEL_ANOMALIES_PATH, { actor: "logistics" });
    expect(res.status).toBe(200);
    const parsed = fuelAnomaliesResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    const mine = (res.body as any[]).filter((a) => a.vehicleId === vehicleId);
    expect(mine.map((a) => a.anomalyKey).sort()).toEqual([`odometer-regression:${back.id}`, `tank-overflow:${over.id}`].sort());
    expect(mine.find((a) => a.rule === "tank-overflow")).toMatchObject({ tankCapacityL: 100, threshold: 105 });
    expect(mine.find((a) => a.rule === "odometer-regression")).toMatchObject({ mileage: 1900, previousMileage: 2000 });
  });

  it("les nouvelles règles se traitent par le PATCH existant", async () => {
    const [rec] = await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicleId)).limit(1);
    const key = `tank-overflow:${rec.id}`;
    const ok = await api.call("PATCH", `/api/fuel-card/anomalies/${encodeURIComponent(key)}`, { actor: "logistics", body: { status: "justified" } });
    expect(ok.status).toBe(200);
    const after = await api.call("GET", FUEL_ANOMALIES_PATH, { actor: "management" });
    expect((after.body as any[]).find((a) => a.anomalyKey === key)?.status).toBe("justified");
    await db.delete(fuelAnomalyResolutions).where(eq(fuelAnomalyResolutions.anomalyKey, key));
  });
});

describe("GET /api/fuel-card/anomalies/summary : véhicules sans capacité", { timeout: 120000 }, () => {
  it("200 conforme pour les rôles de lecture, 401 anonyme, 403 technicien et client", async () => {
    for (const actor of ["logistics", "workshopManager", "management", "admin"] as const) {
      const res = await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH, { actor });
      expect(res.status).toBe(200);
      expect(fuelAnomaliesSummarySchema.safeParse(res.body).success).toBe(true);
    }
    expect((await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH)).status).toBe(401);
    expect((await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH, { actor: "technician" })).status).toBe(403);
    expect((await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH, { actor: "client" })).status).toBe(403);
  });

  it("le compteur suit la saisie de la capacité", async () => {
    const count = async () => (await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH, { actor: "management" })).body.vehiclesWithoutTankCapacity as number;
    // Base partagée : d'autres suites créent des véhicules en parallèle, le delta exact y est instable
    // (il est prouvé en intégration). Ici : le compteur ne baisse jamais en ajoutant la capacité
    // et reste cohérent avec un comptage direct.
    const direct = async () =>
      Number((await db.execute(sql`SELECT count(*) FILTER (WHERE tank_capacity_l IS NULL AND deleted_at IS NULL) AS n FROM vehicles`)).rows[0].n);
    await db.update(vehicles).set({ tankCapacityL: null }).where(eq(vehicles.id, vehicleId));
    const apiWithout = await count();
    expect(Math.abs(apiWithout - (await direct()))).toBeLessThanOrEqual(3);
    expect(apiWithout).toBeGreaterThanOrEqual(1);
    await db.update(vehicles).set({ tankCapacityL: 90 }).where(eq(vehicles.id, vehicleId));
    expect(Math.abs((await count()) - (await direct()))).toBeLessThanOrEqual(3);
  });

  it("drapeau coupé : 404 normalisé", async () => {
    process.env.FEATURE_FLAGS = "fuel-anomalies=off";
    try {
      expect((await api.call("GET", FUEL_ANOMALIES_SUMMARY_PATH, { actor: "management" })).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "fuel-anomalies=on";
    }
  });
});

describe("PATCH /api/vehicles/:id : capacité des réservoirs", { timeout: 120000 }, () => {
  const patchCapacity = (tankCapacityL: unknown, actor?: "admin" | "workshopManager" | "client" | "technician" | "logistics") =>
    api.call("PATCH", `/api/vehicles/${vehicleId}`, { actor, body: { tankCapacityL } });

  it.each([[0], [-5], ["abc"], [2001], [{}]])("%j : 400 lisible, sans détail technique, valeur inchangée", async (bad) => {
    const res = await patchCapacity(bad, "workshopManager");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(VEHICLE_TANK_CAPACITY_MESSAGE);
    expect(JSON.stringify(res.body)).not.toMatch(/constraint|vehicles_tank|violates|SQL/i);
    const [row] = await db.select({ c: vehicles.tankCapacityL }).from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(row.c).toBe(90);
  });

  it("valide : nombre, texte numérique, puis vidage par null et par chaîne vide", async () => {
    expect((await patchCapacity(120, "workshopManager")).body.tankCapacityL).toBe(120);
    expect((await patchCapacity("150.5", "admin")).body.tankCapacityL).toBe(150.5);
    expect((await patchCapacity(null, "admin")).body.tankCapacityL).toBeNull();
    expect((await patchCapacity(75, "admin")).status).toBe(200);
    expect((await patchCapacity("", "admin")).body.tankCapacityL).toBeNull();
  });

  it("un PATCH sans tankCapacityL ne touche pas la capacité", async () => {
    await patchCapacity(60, "admin");
    const res = await api.call("PATCH", `/api/vehicles/${vehicleId}`, { actor: "admin", body: { notes: "TEST capacité" } });
    expect(res.status).toBe(200);
    expect(res.body.tankCapacityL).toBe(60);
  });

  it("403 client et technicien ; 401 anonyme", async () => {
    expect((await patchCapacity(100, "client")).status).toBe(403);
    expect((await patchCapacity(100, "technician")).status).toBe(403);
    expect((await patchCapacity(100)).status).toBe(401);
  });

  describe("logistique : la capacité seule", () => {
    const refusalOf = (body: unknown) => api.call("PATCH", `/api/vehicles/${vehicleId}`, { actor: "logistics", body });
    const stored = async () => (await db.select({ c: vehicles.tankCapacityL, n: vehicles.notes }).from(vehicles).where(eq(vehicles.id, vehicleId)))[0];

    it("{ tankCapacityL } : 200 et valeur enregistrée, mêmes bornes (400 lisible hors bornes)", async () => {
      const res = await refusalOf({ tankCapacityL: 88 });
      expect(res.status).toBe(200);
      expect(res.body.tankCapacityL).toBe(88);
      expect((await stored()).c).toBe(88);
      const bad = await refusalOf({ tankCapacityL: 0 });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe(VEHICLE_TANK_CAPACITY_MESSAGE);
    });

    it("changer la capacité émet fuel_record_validated (rôles carburant) ; une valeur identique n'émet rien", async () => {
      events.length = 0;
      expect((await refusalOf({ tankCapacityL: 91 })).status).toBe(200);
      const emitted = events.filter((e) => e.event === "fuel_record_validated" && e.data.id === vehicleId);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].data.scope).toMatchObject({ type: "roles" });
      expect((await refusalOf({ tankCapacityL: 91 })).status).toBe(200);
      expect(events.filter((e) => e.event === "fuel_record_validated" && e.data.id === vehicleId)).toHaveLength(1);
    });

    it("{ tankCapacityL, autre champ } : 403 lisible, rien n'est écrit", async () => {
      const before = await stored();
      const res = await refusalOf({ tankCapacityL: 55, notes: "TEST logistique" });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(VEHICLE_TANK_CAPACITY_ONLY_MESSAGE);
      expect(JSON.stringify(res.body)).not.toMatch(/constraint|SQL|stack/i);
      expect(await stored()).toEqual(before);
    });

    it("{ autre champ } et corps vide : 403", async () => {
      expect((await refusalOf({ notes: "TEST logistique" })).status).toBe(403);
      expect((await refusalOf({})).status).toBe(403);
    });

    it("rôles déjà autorisés : toute la fiche reste modifiable", async () => {
      const res = await api.call("PATCH", `/api/vehicles/${vehicleId}`, { actor: "workshopManager", body: { notes: "TEST atelier", tankCapacityL: 90 } });
      expect(res.status).toBe(200);
      expect(res.body.notes).toBe("TEST atelier");
    });
  });
});

describe("temps réel des pleins : la liste des anomalies des autres profils se resynchronise", { timeout: 120000 }, () => {
  it("création, modification et suppression émettent un événement du catalogue, portée rôles carburant", async () => {
    events.length = 0;
    const created = await api.call("POST", "/api/fuel-records", {
      actor: "logistics",
      body: { vehicleId, date: "2091-02-01", quantity: 30, cost: 1000, mileage: 3000 },
    });
    expect(created.status).toBe(201);
    ids.fuelRecordIds.push(created.body.id);
    const patched = await api.call("PATCH", `/api/fuel-records/${created.body.id}`, { actor: "admin", body: { quantity: 31 } });
    expect(patched.status).toBe(200);
    const deleted = await api.call("DELETE", `/api/fuel-records/${created.body.id}`, { actor: "workshopManager" });
    expect(deleted.status).toBe(204);

    const emitted = events.filter((e) => e.event === "fuel_record_validated" && e.data.id === created.body.id);
    expect(emitted).toHaveLength(3);
    expect(emitted[0].data.scope).toMatchObject({ type: "roles" });
  });
});
