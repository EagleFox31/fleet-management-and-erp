import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestVehicle } from "../support/factories";
import { leakText } from "../support/api-error";
import { uniqueTestToken } from "../support/ids";

/**
 * Éligibilité CPC d'un chauffeur : règle partagée `shared/constants/driver-cpc-eligibility.ts`.
 * (a) la garde de POST /api/missions compare sans accent ni casse ;
 * (b) GET /api/drivers expose le statut enregistré, que lit cette garde, même si la date manque ;
 * (c) un statut FORMÉ enregistré ne couvre pas une formation expirée (date + 731 jours) : les quatre
 *     gardes (création, PATCH, ajout d'affectation, lancement) refusent en 400.
 */

const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let clientId: number;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function driver(cpcStatus: string, cpcTrainingDate: string | null = null) {
  const [d] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      employeeNumber: uniqueTestToken("emp"),
      cpcStatus,
      cpcTrainingDate,
      isActive: true,
    } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("CPC chauffeur : garde d'affectation et liste", () => {
  it("POST /api/missions accepte un chauffeur au statut FORME sans accent", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const d = await driver("FORME");
    const res = await call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        orderNumber: uniqueTestToken("MIS"),
        clientId,
        status: "planned",
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        assignment: { vehicleId: vehicle.id, driverId: d.id },
      },
    });
    if (res.status === 201) missionIds.push(res.body.id);
    expect(res.status).toBe(201);
  }, 60000);

  it("GET /api/drivers expose cpcStatusRecorded pour un chauffeur sans date de formation", async () => {
    const d = await driver("FORMÉ");
    const res = await call("GET", "/api/drivers", { actor: "logistics" });
    expect(res.status).toBe(200);
    const row = (res.body as any[]).find((r) => r.id === d.id);
    expect(row).toBeTruthy();
    expect(row.cpcStatusRecorded).toBe("FORMÉ");
    // L'affichage reste recalculé depuis la date : c'est l'écart que la règle partagée absorbe.
    expect(row.cpcStatus).toBe("NON FORMÉ");
  }, 60000);

  describe("statut FORMÉ enregistré mais formation expirée (J-800)", () => {
    const EXPIRED = /Formation CPC expirée le \d{2}\/\d{2}\/\d{4}/;

    async function plannedMission(extra: Record<string, unknown> = {}) {
      return call("POST", "/api/missions", {
        actor: "logistics",
        body: {
          orderNumber: uniqueTestToken("MIS"),
          clientId,
          status: "planned",
          pickupAddress: "TEST A",
          deliveryAddress: "TEST B",
          ...extra,
        },
      });
    }

    it("témoin : formation récente (J-100), POST accepté", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const d = await driver("FORMÉ", daysAgo(100));
      const res = await plannedMission({ assignment: { vehicleId: vehicle.id, driverId: d.id } });
      if (res.status === 201) missionIds.push(res.body.id);
      expect(res.status).toBe(201);
    }, 60000);

    it("POST /api/missions : 400", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const d = await driver("FORMÉ", daysAgo(800));
      const res = await plannedMission({ assignment: { vehicleId: vehicle.id, driverId: d.id } });
      if (res.status === 201) missionIds.push(res.body.id);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(EXPIRED);
    }, 60000);

    it("PATCH /api/missions/:id : 400", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const d = await driver("FORMÉ", daysAgo(800));
      const created = await plannedMission();
      missionIds.push(created.body.id);
      const res = await call("PATCH", `/api/missions/${created.body.id}`, {
        actor: "logistics",
        body: { assignment: { vehicleId: vehicle.id, driverId: d.id } },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(EXPIRED);
    }, 60000);

    it("POST /api/missions/:id/assignments : 400", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const d = await driver("FORMÉ", daysAgo(800));
      const created = await plannedMission();
      missionIds.push(created.body.id);
      const res = await call("POST", `/api/missions/${created.body.id}/assignments`, {
        actor: "logistics",
        body: { vehicleId: vehicle.id, driverId: d.id },
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(EXPIRED);
    }, 60000);

    it("PUT /api/missions/:id/status in_progress : refus motivé par le CPC", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const d = await driver("FORMÉ", daysAgo(100));
      const created = await plannedMission({ assignment: { vehicleId: vehicle.id, driverId: d.id } });
      expect(created.status).toBe(201);
      missionIds.push(created.body.id);
      // La formation expire après l'affectation : seule la garde de lancement peut encore l'arrêter.
      await db.update(drivers).set({ cpcTrainingDate: daysAgo(800) } as any).where(inArray(drivers.id, [d.id]));
      const res = await call("PUT", `/api/missions/${created.body.id}/status`, {
        actor: "logistics",
        body: { status: "in_progress" },
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(EXPIRED);
    }, 60000);
  });
});

describe("CPC chauffeur : bornes de l'expiration et launch-readiness", () => {
  const EXPIRED = /Formation CPC expirée le \d{2}\/\d{2}\/\d{4}/;

  function createMission(vehicleId: number, driverId: number) {
    return call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        orderNumber: uniqueTestToken("MIS"),
        clientId,
        status: "planned",
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        assignment: { vehicleId, driverId },
      },
    });
  }

  it("formation à J-731 (dernier jour valable) : POST /api/missions accepté", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const d = await driver("FORMÉ", daysAgo(731));
    const res = await createMission(vehicle.id, d.id);
    if (res.status === 201) missionIds.push(res.body.id);
    expect(res.status).toBe(201);
  }, 60000);

  it("formation à J-732 (expirée depuis hier) : POST /api/missions refusé en 400", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const d = await driver("FORMÉ", daysAgo(732));
    const res = await createMission(vehicle.id, d.id);
    if (res.status === 201) missionIds.push(res.body.id);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(EXPIRED);
  }, 60000);

  it("launch-readiness avec un chauffeur à J-800 : non prêt, raison lisible", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const d = await driver("FORMÉ", daysAgo(100));
    const created = await createMission(vehicle.id, d.id);
    expect(created.status).toBe(201);
    missionIds.push(created.body.id);
    await db.update(drivers).set({ cpcTrainingDate: daysAgo(800) } as any).where(inArray(drivers.id, [d.id]));
    const res = await call("GET", `/api/missions/${created.body.id}/launch-readiness`, { actor: "logistics" });
    expect(res.status).toBe(200);
    expect(res.body.canLaunch).toBe(false);
    const check = res.body.checks.find((c: any) => c.key === "driver_cpc_valid");
    expect(check.passed).toBe(false);
    expect(check.blocking).toBe(true);
    // Libellé fixe sans date : launch-readiness est lu par tout le personnel, chauffeurs compris.
    expect(check.detail).toBe("Formation CPC expirée.");
    expect(check.cpcIneligibleCode).toBe("EXPIRED");
  }, 60000);
});

describe("CPC chauffeur : date de formation future refusée à la saisie", () => {
  const FUTURE_MESSAGE = /date de formation CPC ne peut pas être dans le futur/;

  function daysFromNow(n: number): string {
    return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  }

  function createDriverBody(extra: Record<string, unknown> = {}) {
    return { firstName: "TEST", lastName: uniqueTestToken("drv"), ...extra };
  }

  it("POST /api/drivers avec une date future : 400 lisible, rien créé", async () => {
    const body = createDriverBody({ cpcTrainingDate: daysFromNow(10) });
    const res = await call("POST", "/api/drivers", { actor: "logistics", body });
    if (res.body?.id) driverIds.push(res.body.id);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(FUTURE_MESSAGE);
    const rows = await db.select().from(drivers).where(eq(drivers.lastName, body.lastName));
    expect(rows).toHaveLength(0);
  }, 60000);

  it("POST /api/drivers avec la date du jour : 201", async () => {
    const res = await call("POST", "/api/drivers", {
      actor: "logistics",
      body: createDriverBody({ cpcTrainingDate: daysFromNow(0) }),
    });
    if (res.body?.id) driverIds.push(res.body.id);
    expect(res.status).toBe(201);
  }, 60000);

  it("PATCH /api/drivers/:id avec une date future : 400, date inchangée", async () => {
    const d = await driver("FORMÉ", daysAgo(10));
    const res = await call("PATCH", `/api/drivers/${d.id}`, {
      actor: "logistics",
      body: { cpcTrainingDate: daysFromNow(10) },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(FUTURE_MESSAGE);
    const [row] = await db.select().from(drivers).where(eq(drivers.id, d.id));
    expect(row.cpcTrainingDate).toBe(daysAgo(10));
  }, 60000);

  it("PATCH d'un autre champ sur un chauffeur dont la date future est déjà en base : 200", async () => {
    const d = await driver("FORMÉ", daysFromNow(30));
    const res = await call("PATCH", `/api/drivers/${d.id}`, {
      actor: "logistics",
      body: { firstName: "Renommé" },
    });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe("Renommé");
    const [row] = await db.select().from(drivers).where(eq(drivers.id, d.id));
    expect(row.cpcTrainingDate).toBe(daysFromNow(30));
  }, 60000);

  it("POST /api/drivers : champ au mauvais type sans message personnalisé, message générique et détail en français", async () => {
    const res = await call("POST", "/api/drivers", {
      actor: "logistics",
      body: { firstName: "TEST", lastName: 123 },
    });
    if (res.body?.id) driverIds.push(res.body.id);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Données chauffeur invalides");
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e: any) => e.field === "lastName")).toBe(true);
    expect(leakText(res.body)).not.toMatch(/Expected|Required/);
  }, 60000);

  it("POST /api/drivers : champ obligatoire absent, aucun texte Zod anglais", async () => {
    const res = await call("POST", "/api/drivers", { actor: "logistics", body: { firstName: "TEST" } });
    if (res.body?.id) driverIds.push(res.body.id);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Données chauffeur invalides");
    expect(leakText(res.body)).not.toMatch(/Expected|Required/);
  }, 60000);

  it("PATCH /api/drivers/:id : message personnalisé du schéma repris dans message", async () => {
    const d = await driver("FORMÉ", daysAgo(10));
    const res = await call("PATCH", `/api/drivers/${d.id}`, { actor: "logistics", body: { firstName: "" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Le prénom est requis");
    expect(res.body.errors[0].field).toBe("firstName");
  }, 60000);

  it("PATCH /api/drivers/:id : mauvais type, message générique", async () => {
    const d = await driver("FORMÉ", daysAgo(10));
    const res = await call("PATCH", `/api/drivers/${d.id}`, { actor: "logistics", body: { firstName: 42 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Données chauffeur invalides");
    expect(leakText(res.body)).not.toMatch(/Expected|Required/);
  }, 60000);

  it("POST /api/drivers/:id/update-cpc avec une date future : 400 lisible, date inchangée", async () => {
    const d = await driver("FORMÉ", daysAgo(10));
    const res = await call("POST", `/api/drivers/${d.id}/update-cpc`, {
      actor: "logistics",
      body: { cpcDate: daysFromNow(10) },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(FUTURE_MESSAGE);
    const [row] = await db.select().from(drivers).where(eq(drivers.id, d.id));
    expect(row.cpcTrainingDate).toBe(daysAgo(10));
  }, 60000);

  it("POST /api/drivers/:id/update-cpc avec la date du jour : 200", async () => {
    const d = await driver("FORMÉ", daysAgo(10));
    const res = await call("POST", `/api/drivers/${d.id}/update-cpc`, {
      actor: "logistics",
      body: { cpcDate: daysFromNow(0) },
    });
    expect(res.status).toBe(200);
  }, 60000);
});
