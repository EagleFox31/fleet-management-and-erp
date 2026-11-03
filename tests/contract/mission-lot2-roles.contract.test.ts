import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Droits missions, lot 2 (décision utilisateur, 3 novembre 2026) :
 * - `POST /api/missions` est réservé aux gestionnaires (MISSION_MANAGER_ROLES) ;
 * - `PUT /api/missions/:id/status` est ouvert aux gestionnaires et au chauffeur affecté,
 *   sur ses seules missions. Les autres rôles du personnel reçoivent 403 sans écriture.
 * Le client est déjà refusé au montage du routeur.
 */

type Actor = "admin" | "logistics" | "secretary" | "management" | "workshop_manager" | "driver" | "technician" | "warehouse" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const missionIds: number[] = [];
const ids = createIdBag();
const ORDER_PREFIX = uniqueTestToken("LOT2");
let ownDriverId = 0;
let otherDriverId = 0;
let vehicleId = 0;
let otherVehicleId = 0;

const NON_MANAGERS = ["technician", "warehouse", "management", "workshop_manager"] as const;

async function createMission(status: string, driverId: number, vId: number) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MIS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status,
      pickupDate: new Date(Date.UTC(2031, 5, 10, 8)),
      deliveryDate: new Date(Date.UTC(2031, 5, 12, 8)),
    } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: vId, driverId } as any);
  return m.id;
}

async function statusOf(id: number) {
  const [m] = await db.select({ status: missions.status }).from(missions).where(eq(missions.id, id));
  return m.status;
}

async function createdCount() {
  const rows = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${ORDER_PREFIX}%`));
  return rows.length;
}

const newMissionBody = (suffix: string) => ({
  orderNumber: `${ORDER_PREFIX}-${suffix}`,
  pickupAddress: "TEST A",
  deliveryAddress: "TEST B",
  status: "draft",
});

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    logistics: "logistics",
    secretary: "secretary",
    management: "management",
    workshop_manager: "workshop_manager",
    driver: "driver",
    technician: "technician",
    warehouse: "warehouse",
    client: "client",
  });
  const [own] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), userId: session.userId("driver") } as any)
    .returning();
  const [other] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv") } as any)
    .returning();
  driverIds.push(own.id, other.id);
  ownDriverId = own.id;
  otherDriverId = other.id;
  const [v1, v2] = [await createTestVehicle(), await createTestVehicle()];
  ids.vehicleIds.push(v1.id, v2.id);
  vehicleId = v1.id;
  otherVehicleId = v2.id;
}, 120000);

afterAll(async () => {
  const created = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${ORDER_PREFIX}%`));
  missionIds.push(...created.map((m) => m.id));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.stop();
}, 120000);

describe("Lot 2 : POST /api/missions réservé aux gestionnaires", { timeout: 180000 }, () => {
  it.each(["driver", ...NON_MANAGERS, "client"] as const)("%s : 403 et aucune mission créée", async (actor) => {
    const before = await createdCount();
    const res = await session.call("POST", "/api/missions", { actor, body: newMissionBody(actor) });
    expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(403);
    expect(await createdCount()).toBe(before);
  });

  // Contre-épreuve : le même corps crée bien une mission pour chaque gestionnaire.
  it.each(["admin", "logistics", "secretary"] as const)("%s : 201 et mission créée", async (actor) => {
    const before = await createdCount();
    const res = await session.call("POST", "/api/missions", { actor, body: newMissionBody(actor) });
    expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
    expect(await createdCount()).toBe(before + 1);
  });

  // Une mission naît en brouillon ou planifiée, puis avance par PUT /:id/status.
  it("la création refuse un statut avancé (400, aucune mission)", async () => {
    const before = await createdCount();
    const res = await session.call("POST", "/api/missions", {
      actor: "logistics",
      body: { ...newMissionBody("completed"), status: "completed" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await createdCount()).toBe(before);
  });

  // Coût réel et budgets se saisissent par PATCH /:id : la création les ignore.
  it("la création garde le statut planned de l'écran et ignore coût réel et budgets", async () => {
    const res = await session.call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        ...newMissionBody("hostile"),
        status: "planned",
        actualFuelCost: "999999",
        workflowData: { budgetPlan: { fuelBudget: 1, roadExpensesBudget: 1, contingencyBudget: 1 } },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [m] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(m.status).toBe("planned");
    expect(m.actualFuelCost).toBeNull();
    expect((m.workflowData as any)?.budgetPlan ?? null).toBeNull();
  });
});

describe("Lot 2 : PUT /api/missions/:id/status, gestionnaires et chauffeur affecté", { timeout: 180000 }, () => {
  it.each(NON_MANAGERS)("%s : 403 et statut inchangé", async (actor) => {
    const id = await createMission("assigned", otherDriverId, otherVehicleId);
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor, body: { status: "cancelled" } });
    expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(403);
    expect(await statusOf(id)).toBe("assigned");
  });

  it("chauffeur d'une autre mission : 403 et statut inchangé", async () => {
    const id = await createMission("in_progress", otherDriverId, otherVehicleId);
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor: "driver", body: { status: "delivered" } });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await statusOf(id)).toBe("in_progress");
  });

  // Engagement pris auprès de #10b : le chauffeur affecté garde in_progress -> delivered.
  it("chauffeur affecté : 200, in_progress -> delivered", async () => {
    const id = await createMission("in_progress", ownDriverId, vehicleId);
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor: "driver", body: { status: "delivered" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(id)).toBe("delivered");
  });

  // Contre-épreuve du refus : le même corps est appliqué pour chaque gestionnaire.
  it.each(["admin", "logistics", "secretary"] as const)("%s : 200, assigned -> cancelled", async (actor) => {
    const id = await createMission("assigned", otherDriverId, otherVehicleId);
    const res = await session.call("PUT", `/api/missions/${id}/status`, { actor, body: { status: "cancelled" } });
    expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(200);
    expect(await statusOf(id)).toBe("cancelled");
  });
});
