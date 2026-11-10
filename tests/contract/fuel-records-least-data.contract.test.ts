import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, fuelRecords, missions, users, vehicles } from "../../shared/schema";
import { ALL_APP_ROLES, MISSION_READ_ROLES } from "../../shared/constants/roles";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { TEST_USER_PASSWORD, createTestFuelRecord, createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * Moindre donnée sur les chemins carburant encore servis par server/routes.ts (gelé).
 *
 *  - POST /api/fuel-records, PATCH /api/fuel-records/:id et POST /api/fuel-records/:id/cancel
 *    renvoyaient la ligne brute : `balance` et `fuelBalance` (solde de la carte) partaient
 *    chez le chef d'atelier, qui saisit des pleins mais ne lit pas la trésorerie.
 *    Un lecteur du trésor les reçoit toujours ; l'écriture reste effective.
 *  - GET /api/fuel-records/statistics était ouvert à tout compte : chauffeur, technicien,
 *    magasinier et lecteur lisaient les agrégats de toute la flotte. Réservé au pilotage
 *    (FUEL_READ_ROLES) et au client, toujours cloisonné à ses véhicules.
 */

const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  workshop_manager: "workshop_manager",
  driver: "driver",
  technician: "technician",
  warehouse: "warehouse",
  viewer: "viewer",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const BALANCE_KEYS = ["balance", "fuelBalance"] as const;

async function vehicle(overrides: Parameters<typeof createTestVehicle>[0] = {}) {
  const v = await createTestVehicle(overrides);
  ids.vehicleIds.push(v.id);
  return v;
}

/** Plein physique (n'a pas bougé la carte), avec un solde renseigné pour rendre la fuite visible. */
async function physicalRecord(validated: boolean) {
  const v = await vehicle();
  const row = await createTestFuelRecord({
    vehicleId: v.id,
    debitAmount: "0",
    creditAmount: "0",
    cost: "500.00",
    quantity: 2,
  });
  ids.fuelRecordIds.push(row.id);
  if (validated) await db.update(fuelRecords).set({ validationStatus: "validated" }).where(eq(fuelRecords.id, row.id));
  return row;
}

function expectNoBalance(body: Record<string, unknown>) {
  for (const key of BALANCE_KEYS) expect(body).not.toHaveProperty(key);
}
function expectBalanceKeys(body: Record<string, unknown>) {
  for (const key of BALANCE_KEYS) expect(body).toHaveProperty(key);
}

/** Les véhicules de test partent de 100 000 km : le kilométrage saisi doit les dépasser. */
async function create(actor: Actor, mileage: number) {
  const v = await vehicle();
  const res = await session.call("POST", "/api/fuel-records", {
    actor,
    body: { vehicleId: v.id, date: "2026-11-01", quantity: 40, cost: 30000, mileage, fullTank: true },
  });
  if (res.status === 201 && res.body?.id) ids.fuelRecordIds.push(res.body.id);
  return { res, vehicleId: v.id };
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length) await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  ids.fuelRecordIds.length = 0;
  await cleanupCreated(ids);
  await session?.close();
});

describe("POST /api/fuel-records : solde carte masqué hors trésorerie", { timeout: 60000 }, () => {
  it("chef d'atelier : 201 sans balance ni fuelBalance, kilométrage mis à jour", async () => {
    const { res, vehicleId } = await create("workshop_manager", 100500);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicleId, mileage: 100500 });
    expectNoBalance(res.body);
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    expect(v.mileage).toBe(100500);
  });

  it("lecteurs du trésor (admin, logistique) : les clés de solde restent servies", async () => {
    for (const actor of ["admin", "logistics"] as const) {
      const { res } = await create(actor, 100200);
      expect(res.status).toBe(201);
      expectBalanceKeys(res.body);
    }
  });
});

describe("PATCH /api/fuel-records/:id : solde carte masqué hors trésorerie", { timeout: 60000 }, () => {
  it("chef d'atelier, auteur du plein : 200 sans balance ni fuelBalance, modification écrite", async () => {
    // Hors admin, seul l'auteur modifie son plein (canEditFuelRecord) : il le saisit d'abord.
    const { res: created } = await create("workshop_manager", 100300);
    expect(created.status).toBe(201);
    const r = created.body as { id: number };
    const res = await session.call("PATCH", `/api/fuel-records/${r.id}`, {
      actor: "workshop_manager",
      body: { notes: "Plein corrigé", mileage: 100350 },
    });
    expect(res.status).toBe(200);
    expectNoBalance(res.body);
    expect(res.body).toMatchObject({ id: r.id, mileage: 100350 });
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, r.id));
    expect(row.notes).toBe("Plein corrigé");
    expect(row.mileage).toBe(100350);
  });

  it("admin : les clés de solde restent servies", async () => {
    const r = await physicalRecord(false);
    const res = await session.call("PATCH", `/api/fuel-records/${r.id}`, { actor: "admin", body: { notes: "Vu" } });
    expect(res.status).toBe(200);
    expectBalanceKeys(res.body);
  });
});

describe("POST /api/fuel-records/:id/cancel : solde carte masqué hors trésorerie", { timeout: 60000 }, () => {
  it("chef d'atelier : 200 sans balance ni fuelBalance, plein annulé", async () => {
    const r = await physicalRecord(true);
    const res = await session.call("POST", `/api/fuel-records/${r.id}/cancel`, {
      actor: "workshop_manager",
      body: { reason: "Doublon de saisie" },
    });
    expect(res.status).toBe(200);
    expectNoBalance(res.body);
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, r.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it("admin : les clés de solde restent servies", async () => {
    const r = await physicalRecord(true);
    const res = await session.call("POST", `/api/fuel-records/${r.id}/cancel`, {
      actor: "admin",
      body: { reason: "Doublon de saisie" },
    });
    expect(res.status).toBe(200);
    expectBalanceKeys(res.body);
  });
});

describe("GET /api/fuel-records/statistics : pilotage et client seulement", { timeout: 60000 }, () => {
  for (const actor of ["driver", "technician", "warehouse", "viewer"] as const) {
    it(`${actor} : 403`, async () => {
      const res = await session.call("GET", "/api/fuel-records/statistics", { actor });
      expect(res.status).toBe(403);
    });
  }

  for (const actor of ["admin", "workshop_manager", "logistics"] as const) {
    it(`${actor} : 200`, async () => {
      const res = await session.call("GET", "/api/fuel-records/statistics", { actor });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("vehicleStats");
    });
  }

  it("client : 200, son véhicule présent, celui d'un autre client absent", async () => {
    // Plein daté du jour : la période par défaut (un mois) l'inclut dans vehicleStats.
    const today = new Date().toISOString().slice(0, 10);
    const otherClient = await createTestUser({ role: "client" });
    ids.userIds.push(otherClient.id);
    const own = await vehicle({ ownerId: session.userIdOf("client") });
    const foreign = await vehicle({ ownerId: otherClient.id });
    for (const v of [own, foreign]) {
      const row = await createTestFuelRecord({ vehicleId: v.id, date: today, debitAmount: "0", creditAmount: "0" });
      ids.fuelRecordIds.push(row.id);
    }
    const res = await session.call("GET", "/api/fuel-records/statistics", { actor: "client" });
    expect(res.status).toBe(200);
    const seen = (res.body.vehicleStats as Array<{ vehicleId: number }>).map((s) => s.vehicleId);
    expect(seen).toContain(own.id);
    expect(seen).not.toContain(foreign.id);
  });
});

describe("GET des pleins : champs de mission hors MISSION_READ_ROLES", () => {
  const MISSION_KEYS = ["orderNumber", "clientName", "destination"] as const;

  async function recordWithMission() {
    const v = await vehicle();
    const row = await createTestFuelRecord({ vehicleId: v.id, debitAmount: "0", creditAmount: "0", cost: "500.00", quantity: 2 });
    ids.fuelRecordIds.push(row.id);
    await db.update(fuelRecords).set({ orderNumber: "BC-TEST-1", clientName: "TEST CLIENT", destination: "TEST DOUALA" }).where(eq(fuelRecords.id, row.id));
    return { vehicleId: v.id, id: row.id };
  }

  it("technicien : ni numéro de commande, ni client, ni destination ; les autres champs restent", async () => {
    const { vehicleId, id } = await recordWithMission();
    for (const path of [`/api/fuel-records?vehicleId=${vehicleId}`, `/api/fuel-records/vehicle/${vehicleId}`]) {
      const res = await session.call("GET", path, { actor: "technician" });
      expect(res.status, path).toBe(200);
      const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === id)!;
      expect(row, path).toBeTruthy();
      for (const key of MISSION_KEYS) expect(row, `${path} ${key}`).not.toHaveProperty(key);
      expect(row.quantity, path).toBe(2);
    }
  });

  function rowOf(res: { body: unknown }, id: number) {
    return (res.body as Array<Record<string, unknown>>).find((r) => r.id === id)!;
  }

  it("client : ni numéro de commande, ni client, ni destination sur les pleins de son véhicule", async () => {
    const v = await vehicle({ ownerId: session.userIdOf("client") } as Parameters<typeof createTestVehicle>[0]);
    const row = await createTestFuelRecord({ vehicleId: v.id, debitAmount: "0", creditAmount: "0", cost: "500.00", quantity: 2 });
    ids.fuelRecordIds.push(row.id);
    await db.update(fuelRecords).set({ orderNumber: "BC-TEST-C", clientName: "TEST CLIENT", destination: "TEST KRIBI" }).where(eq(fuelRecords.id, row.id));
    for (const path of [`/api/fuel-records?vehicleId=${v.id}`, `/api/fuel-records/vehicle/${v.id}`, "/api/fuel-records"]) {
      const res = await session.call("GET", path, { actor: "client" });
      expect(res.status, path).toBe(200);
      const found = rowOf(res, row.id);
      expect(found, path).toBeTruthy();
      for (const key of MISSION_KEYS) expect(found, `${path} ${key}`).not.toHaveProperty(key);
    }
  });

  /**
   * Rôle stocké hors enum : `normalizeRole` le lit `user`, rôle du personnel (MISSION_READ_ROLES).
   * Les champs de mission des pleins suivent alors la lecture des missions, ni plus ni moins :
   * servis si et seulement si GET /api/missions répond 200 au même compte.
   */
  it("rôle inconnu (hors enum) : champs de mission servis exactement comme la lecture des missions", async () => {
    const { vehicleId, id } = await recordWithMission();
    const user = await createTestUser({ role: "technician" });
    ids.userIds.push(user.id);
    const login = await fetch(`${session.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0] };
    await db.update(users).set({ role: "pilote" as never }).where(eq(users.id, user.id));
    const readsMissions = (await session.call("GET", "/api/missions", { headers })).status === 200;
    for (const path of [`/api/fuel-records?vehicleId=${vehicleId}`, `/api/fuel-records/vehicle/${vehicleId}`]) {
      const res = await session.call("GET", path, { headers });
      if (res.status !== 200) {
        expect(res.status, path).toBe(403);
        continue;
      }
      const found = rowOf(res, id);
      for (const key of MISSION_KEYS) expect(Object.hasOwn(found, key), `${path} ${key}`).toBe(readsMissions);
    }
  });

  it("tout rôle hors MISSION_READ_ROLES est joué par ce contrat", () => {
    const outside = ALL_APP_ROLES.filter((r) => !MISSION_READ_ROLES.includes(r)).sort();
    expect(outside).toEqual(["client", "technician"]);
  });

  describe("chauffeur : champs de mission sur les pleins de SES missions seulement", () => {
    const missionIds: number[] = [];
    let driverId = 0;

    async function mission(assignmentStatus?: string) {
      const v = await vehicle();
      const [m] = await db
        .insert(missions)
        .values({ orderNumber: uniqueTestToken("FRS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned" } as any)
        .returning();
      missionIds.push(m.id);
      if (assignmentStatus) await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId, status: assignmentStatus } as any);
      const row = await createTestFuelRecord({ vehicleId: v.id, debitAmount: "0", creditAmount: "0", cost: "500.00", quantity: 2 });
      ids.fuelRecordIds.push(row.id);
      await db
        .update(fuelRecords)
        .set({ missionId: m.id, orderNumber: "BC-TEST-D", clientName: "TEST CLIENT", destination: "TEST EDEA" })
        .where(eq(fuelRecords.id, row.id));
      return { vehicleId: v.id, id: row.id };
    }

    beforeAll(async () => {
      const [d] = await db
        .insert(drivers)
        .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
        .returning();
      driverId = d.id;
    }, 60000);

    afterAll(async () => {
      if (missionIds.length) {
        await deleteFuelRecordsWhere(inArray(fuelRecords.missionId, missionIds));
        await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
        await db.delete(missions).where(inArray(missions.id, missionIds));
      }
      if (driverId) await db.delete(drivers).where(eq(drivers.id, driverId));
    }, 60000);

    it("sa mission (affectation vivante) : champs lus ; mission d'un autre ou affectation annulée : masqués", async () => {
      const own = await mission("accepted");
      const others = await mission();
      const cancelled = await mission("cancelled");
      for (const { vehicleId, id, kept } of [
        { ...own, kept: true },
        { ...others, kept: false },
        { ...cancelled, kept: false },
      ]) {
        for (const path of [`/api/fuel-records?vehicleId=${vehicleId}`, `/api/fuel-records/vehicle/${vehicleId}`]) {
          const res = await session.call("GET", path, { actor: "driver" });
          expect(res.status, path).toBe(200);
          const found = rowOf(res, id);
          expect(found, path).toBeTruthy();
          if (kept) expect(found, path).toMatchObject({ orderNumber: "BC-TEST-D", clientName: "TEST CLIENT", destination: "TEST EDEA" });
          else for (const key of MISSION_KEYS) expect(found, `${path} ${key}`).not.toHaveProperty(key);
          expect(found.quantity, path).toBe(2);
        }
      }
    });
  });

  it("logistique et chef d'atelier (MISSION_READ_ROLES) : les champs de mission restent lisibles", async () => {
    const { vehicleId, id } = await recordWithMission();
    for (const actor of ["logistics", "workshop_manager"] as Actor[]) {
      const res = await session.call("GET", `/api/fuel-records/vehicle/${vehicleId}`, { actor });
      expect(res.status, actor).toBe(200);
      const row = (res.body as Array<Record<string, unknown>>).find((r) => r.id === id)!;
      expect(row, actor).toMatchObject({ orderNumber: "BC-TEST-1", clientName: "TEST CLIENT", destination: "TEST DOUALA" });
    }
  });
});
