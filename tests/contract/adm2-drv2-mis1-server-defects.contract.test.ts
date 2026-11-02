import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, incidents, missions, users, vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createIncident } from "../../server/services/incident-service";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Défauts serveur figés par les e2e ADM2 / DRV2 / MIS1, corrigés ensemble :
 * - ADM2-3 : /api/purchase-orders lit le rôle courant en base, pas celui de la session ;
 * - MIS1-API-1 : PATCH /api/missions/:id applique l'éligibilité du véhicule (maintenance, assurance) ;
 * - DRV2-3 : un chauffeur ne voit et n'agit que sur ses missions ;
 * - DRV2-1/2 : POST /api/driver/breakdowns, ouvert au chauffeur sur son véhicule, crée l'OT.
 */

const ACTORS = {
  admin: "admin",
  warehouse: "warehouse",
  logistics: "logistics",
  workshop: "workshop_manager",
  driverA: "driver",
  driverB: "driver",
  client: "client",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

const FUTURE = "2099-01-01";
const PAST = "2020-01-01";

async function newVehicle(overrides: Partial<typeof vehicles.$inferInsert> = {}, expiries: Record<string, string> = {}) {
  const v = await createTestVehicle(overrides);
  ids.vehicleIds.push(v.id);
  await db
    .update(vehicles)
    .set({ insuranceExpiry: FUTURE, technicalInspectionDate: FUTURE, licensePlateExpiry: FUTURE, ...expiries } as any)
    .where(eq(vehicles.id, v.id));
  return v;
}

async function newDriver(userId: number | null, cpc = "FORME") {
  const [d] = await db
    .insert(drivers)
    .values({ userId, firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: cpc } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

async function newMission(assign?: { vehicleId: number; driverId: number }) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MIS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status: assign ? "assigned" : "planned",
    } as any)
    .returning();
  missionIds.push(m.id);
  if (assign) {
    await db.insert(assignments).values({ missionId: m.id, vehicleId: assign.vehicleId, driverId: assign.driverId, status: "accepted" } as any);
  }
  return m;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    await db.delete(incidents).where(inArray(incidents.vehicleId, ids.vehicleIds));
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
  }
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("ADM2-3 : rôle courant sur /api/purchase-orders", { timeout: 180000 }, () => {
  it("un magasinier passé logisticien perd le périmètre pièces sans se reconnecter", async () => {
    const before = await call("GET", "/api/purchase-orders/group-suggestions", { actor: "warehouse" });
    expect(before.status).toBe(200);
    await db.update(users).set({ role: "logistics" }).where(eq(users.id, session.userIdOf("warehouse")));
    const after = await call("GET", "/api/purchase-orders/group-suggestions", { actor: "warehouse" });
    expect(after.status).toBe(403);
    await db.update(users).set({ role: "warehouse" }).where(eq(users.id, session.userIdOf("warehouse")));
  });

  it("sans session : 401", async () => {
    expect((await call("GET", "/api/purchase-orders")).status).toBe(401);
  });
});

describe("MIS1-API-1 : éligibilité du véhicule sur PATCH /api/missions/:id", { timeout: 180000 }, () => {
  it("refuse un véhicule en maintenance, avec message et errors", async () => {
    const v = await newVehicle({ status: "maintenance" });
    const d = await newDriver(null);
    const m = await newMission();
    const res = await call("PATCH", `/api/missions/${m.id}`, {
      actor: "logistics",
      body: { assignment: { vehicleId: v.id, driverId: d.id } },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(v.registrationNumber);
    expect(res.body.errors?.[0]?.field).toBe("assignment.vehicleId");
    const rows = await db.select().from(assignments).where(eq(assignments.missionId, m.id));
    expect(rows).toHaveLength(0);
  });

  it("refuse un véhicule à assurance échue", async () => {
    const v = await newVehicle({}, { insuranceExpiry: PAST });
    const d = await newDriver(null);
    const m = await newMission();
    const res = await call("PATCH", `/api/missions/${m.id}`, {
      actor: "logistics",
      body: { assignment: { vehicleId: v.id, driverId: d.id } },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/assurance/i);
    expect(res.body.errors?.[0]?.message).toMatch(/assurance/i);
  });

  it("accepte un véhicule éligible", async () => {
    const v = await newVehicle();
    const d = await newDriver(null);
    const m = await newMission();
    const res = await call("PATCH", `/api/missions/${m.id}`, {
      actor: "logistics",
      body: { assignment: { vehicleId: v.id, driverId: d.id } },
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(assignments).where(eq(assignments.missionId, m.id));
    expect(rows).toHaveLength(1);
  });
});

describe("DRV2-3 : cloison chauffeur sur les missions", { timeout: 180000 }, () => {
  let own: { id: number };
  let foreign: { id: number };
  let ownSecondProfile: { id: number };
  let secondProfileDriverId = 0;
  let driverAId = 0;
  let driverBId = 0;

  beforeAll(async () => {
    const dA = await newDriver(session.userIdOf("driverA"));
    const dB = await newDriver(session.userIdOf("driverB"));
    driverAId = dA.id;
    driverBId = dB.id;
    const vA = await newVehicle();
    const vB = await newVehicle();
    own = await newMission({ vehicleId: vA.id, driverId: dA.id });
    foreign = await newMission({ vehicleId: vB.id, driverId: dB.id });
    // `drivers.user_id` n'est pas unique : le compte A porte une seconde fiche, ses missions comptent aussi.
    const dA2 = await newDriver(session.userIdOf("driverA"));
    const vA2 = await newVehicle();
    ownSecondProfile = await newMission({ vehicleId: vA2.id, driverId: dA2.id });
    secondProfileDriverId = dA2.id;
  }, 120000);

  it("deux fiches pour un même compte : missions des deux, quel que soit l'ordre de création", async () => {
    const listed = ((await call("GET", "/api/missions", { actor: "driverA" })).body as { id: number }[]).map((m) => m.id);
    expect(listed).toEqual(expect.arrayContaining([own.id, ownSecondProfile.id]));
    expect(listed).not.toContain(foreign.id);
    expect((await call("GET", `/api/missions/${ownSecondProfile.id}`, { actor: "driverA" })).status).toBe(200);
    expect((await call("GET", `/api/drivers/${driverAId}/missions`, { actor: "driverA" })).status).toBe(200);
    expect((await call("GET", `/api/drivers/${secondProfileDriverId}/missions`, { actor: "driverA" })).status).toBe(200);
    expect((await call("GET", `/api/drivers/${driverBId}/missions`, { actor: "driverA" })).status).toBe(403);
  });

  it("GET /api/missions : le chauffeur ne liste que ses missions", async () => {
    const res = await call("GET", "/api/missions", { actor: "driverA" });
    expect(res.status).toBe(200);
    const listed = (res.body as { id: number }[]).map((m) => m.id);
    expect(listed).toContain(own.id);
    expect(listed).not.toContain(foreign.id);
  });

  it("le personnel n'est pas cloisonné : toute mission se lit", async () => {
    expect((await call("GET", `/api/missions/${own.id}`, { actor: "logistics" })).status).toBe(200);
    expect((await call("GET", `/api/missions/${foreign.id}`, { actor: "logistics" })).status).toBe(200);
  });

  it("GET /api/missions/:id : sa mission 200, celle d'un autre 403", async () => {
    expect((await call("GET", `/api/missions/${own.id}`, { actor: "driverA" })).status).toBe(200);
    const res = await call("GET", `/api/missions/${foreign.id}`, { actor: "driverA" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBeTruthy();
  });

  it("agir sur la mission d'un autre (PATCH, statut) : 403", async () => {
    expect((await call("PATCH", `/api/missions/${foreign.id}`, { actor: "driverA", body: { cargo: "x" } })).status).toBe(403);
    expect((await call("PUT", `/api/missions/${foreign.id}/status`, { actor: "driverA", body: { status: "in_progress" } })).status).toBe(403);
  });

  it("GET /api/drivers/:id/missions : le sien 200, celui d'un autre 403, personnel 200", async () => {
    expect((await call("GET", `/api/drivers/${driverAId}/missions`, { actor: "driverA" })).status).toBe(200);
    expect((await call("GET", `/api/drivers/${driverBId}/missions`, { actor: "driverA" })).status).toBe(403);
    expect((await call("GET", `/api/drivers/${driverBId}/missions`, { actor: "logistics" })).status).toBe(200);
  });
});

describe("DRV2-1/2 : POST /api/driver/breakdowns", { timeout: 180000 }, () => {
  let ownVehicleId = 0;
  let otherVehicleId = 0;

  beforeAll(async () => {
    const dA = await newDriver(session.userIdOf("driverA"));
    const vOwn = await newVehicle();
    const vOther = await newVehicle();
    ownVehicleId = vOwn.id;
    otherVehicleId = vOther.id;
    await newMission({ vehicleId: vOwn.id, driverId: dA.id });
  }, 120000);

  const body = (vehicleId: number) => ({ vehicleId, description: "Fuite d'huile sous le moteur", severity: "high" });

  it("le chauffeur déclare sur son véhicule : 201, incident, OT lié, alerte atelier", async () => {
    const res = await call("POST", "/api/driver/breakdowns", { actor: "driverA", body: body(ownVehicleId) });
    expect(res.status).toBe(201);
    expect(res.body.workOrderId).toEqual(expect.any(Number));
    expect(res.body.status).toBe("open");
    const [order] = await db.select().from(workOrders).where(eq(workOrders.id, res.body.workOrderId));
    expect(order).toMatchObject({ vehicleId: ownVehicleId, status: "pending", priority: "high" });
    expect(order.createdBy).toBe(session.userIdOf("driverA"));
    // L'atelier le voit dans sa liste d'OT.
    const list = await call("GET", "/api/work-orders", { actor: "workshop" });
    expect(list.status).toBe(200);
  });

  it("accident : 201 et OT lié, comme une panne", async () => {
    const res = await call("POST", "/api/driver/breakdowns", {
      actor: "driverA",
      body: { ...body(ownVehicleId), type: "accident" },
    });
    expect(res.status).toBe(201);
    expect(res.body.workOrderId).toEqual(expect.any(Number));
  });

  it.each(["delay", "other"])("%s : 201, incident enregistré, aucun OT ouvert", async (type) => {
    const marker = uniqueTestToken(`SIGNAL-${type}`);
    const res = await call("POST", "/api/driver/breakdowns", {
      actor: "driverA",
      body: { vehicleId: ownVehicleId, description: marker, severity: "low", type },
    });
    expect(res.status).toBe(201);
    expect(res.body.workOrderId).toBeNull();
    const [row] = await db.select().from(incidents).where(eq(incidents.description, marker));
    expect(row).toMatchObject({ vehicleId: ownVehicleId, workOrderId: null });
    expect(await db.select().from(workOrders).where(eq(workOrders.description, marker))).toHaveLength(0);
  });

  it("type inconnu : 400 lisible", async () => {
    const res = await call("POST", "/api/driver/breakdowns", {
      actor: "driverA",
      body: { ...body(ownVehicleId), type: "vol" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it("véhicule d'un autre : 403, aucun OT", async () => {
    const res = await call("POST", "/api/driver/breakdowns", { actor: "driverA", body: body(otherVehicleId) });
    expect(res.status).toBe(403);
    expect(await db.select().from(workOrders).where(eq(workOrders.vehicleId, otherVehicleId))).toHaveLength(0);
  });

  it("rôles refusés : atelier, client, anonyme", async () => {
    expect((await call("POST", "/api/driver/breakdowns", { actor: "workshop", body: body(ownVehicleId) })).status).toBe(403);
    expect((await call("POST", "/api/driver/breakdowns", { actor: "client", body: body(ownVehicleId) })).status).toBe(403);
    expect((await call("POST", "/api/driver/breakdowns", { body: body(ownVehicleId) })).status).toBe(401);
  });

  it("corps invalide : 400 lisible", async () => {
    const res = await call("POST", "/api/driver/breakdowns", { actor: "driverA", body: { vehicleId: ownVehicleId, description: "x", severity: "high" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it("admin : véhicule inconnu, 404 lisible", async () => {
    const marker = uniqueTestToken("PANNE");
    const res = await call("POST", "/api/driver/breakdowns", {
      actor: "admin",
      body: { vehicleId: 2147483000, description: marker, severity: "high" },
    });
    expect(res.status).toBe(404);
    // Message du service (une route absente renverrait un autre texte) et aucun OT ni incident écrit.
    expect(res.body.message).toMatch(/hicule introuvable/);
    expect(await db.select().from(workOrders).where(eq(workOrders.description, marker))).toHaveLength(0);
    expect(await db.select().from(incidents).where(eq(incidents.description, marker))).toHaveLength(0);
  });

  it("échec dans la transaction après l'insertion de l'OT : aucun OT ne subsiste (rollback)", async () => {
    const marker = uniqueTestToken("ROLLBACK");
    const failingDb = {
      transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        db.transaction((tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === "insert") {
                  return (table: unknown) => {
                    if (table === incidents) throw new Error("échec simulé de l'insertion de l'incident");
                    return (target as any).insert(table);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            }),
          ),
        ),
    };
    await expect(
      createIncident(
        { id: session.userIdOf("admin"), role: "admin" },
        { vehicleId: ownVehicleId, description: marker, severity: "high" },
        {
          db: failingDb,
          assignedVehicleIds: async () => [],
          notifyRoles: async () => undefined,
          broadcast: () => undefined,
        },
        { openWorkOrder: true },
      ),
    ).rejects.toThrow(/simulé/);
    expect(await db.select().from(workOrders).where(eq(workOrders.description, marker))).toHaveLength(0);
    expect(await db.select().from(incidents).where(eq(incidents.description, marker))).toHaveLength(0);
  });
});
