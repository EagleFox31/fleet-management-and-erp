import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestUser, createTestVehicle } from "../support/factories";
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
