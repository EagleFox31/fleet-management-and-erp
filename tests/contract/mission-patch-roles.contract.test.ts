import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { ALL_APP_ROLES, MISSION_MANAGER_ROLES, type AppRole } from "../../shared/constants/roles";
import { assignments, drivers, missions } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * R3 : `PATCH /api/missions/:id` réservé aux gestionnaires de missions (MISSION_MANAGER_ROLES).
 * Le chauffeur affecté n'y a aucune écriture légitime (ni statut ni kilométrage dans le schéma) :
 * coût carburant, budgets, dates, chauffeur et véhicule lui sont fermés. Le client est déjà refusé au montage.
 * Décision utilisateur (option a, 3 novembre 2026) : le chauffeur n'écrit pas les budgets.
 *
 * Les rôles refusés se dérivent du schéma : un rôle ajouté plus tard est testé sans retoucher ce fichier.
 */

type Actor = AppRole;
const REFUSED_ROLES = ALL_APP_ROLES.filter((role) => !(MISSION_MANAGER_ROLES as readonly string[]).includes(role));
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const missionIds: number[] = [];
const ids = createIdBag();
let missionId = 0;
let otherDriverId = 0;
let otherVehicleId = 0;

const FROZEN = {
  estimatedFuelCost: "1000.00",
  pickupDate: new Date(Date.UTC(2031, 5, 10, 8)),
  deliveryDate: new Date(Date.UTC(2031, 5, 12, 8)),
};

const hostileBody = () => ({
  estimatedFuelCost: 1,
  pickupDate: "2031-07-01T08:00:00.000Z",
  deliveryDate: "2031-07-02T08:00:00.000Z",
  assignment: { vehicleId: otherVehicleId, driverId: otherDriverId },
  budget: { fuelBudget: 1, roadExpensesBudget: 1, contingencyBudget: 1 },
});

async function snapshot() {
  const [m] = await db.select().from(missions).where(eq(missions.id, missionId));
  const [a] = await db.select().from(assignments).where(eq(assignments.missionId, missionId));
  return {
    estimatedFuelCost: m.estimatedFuelCost,
    pickupDate: m.pickupDate?.toISOString(),
    deliveryDate: m.deliveryDate?.toISOString(),
    specialInstructions: m.specialInstructions,
    budgetPlan: (m.workflowData as any)?.budgetPlan ?? null,
    driverId: a.driverId,
    vehicleId: a.vehicleId,
  };
}

beforeAll(async () => {
  session = await startContractSession<Actor>(
    Object.fromEntries(ALL_APP_ROLES.map((role) => [role, role])) as Record<Actor, Actor>,
  );
  const [own] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), userId: session.userId("driver") } as any)
    .returning();
  // Chauffeur de remplacement éligible : sans cela le refus serait un 400 métier (CPC), pas la garde.
  const [other] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      isActive: true,
      cpcStatus: "FORMÉ",
      licenseExpiry: "2035-01-01",
    } as any)
    .returning();
  driverIds.push(own.id, other.id);
  otherDriverId = other.id;
  const [v1, v2] = [await createTestVehicle(), await createTestVehicle()];
  ids.vehicleIds.push(v1.id, v2.id);
  otherVehicleId = v2.id;
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MIS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status: "assigned",
      ...FROZEN,
    } as any)
    .returning();
  missionId = m.id;
  missionIds.push(m.id);
  // La mission est affectée au chauffeur connecté : c'est le cas le plus permissif.
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v1.id, driverId: own.id } as any);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.stop();
}, 120000);

describe("R3 : PATCH /api/missions/:id réservé aux gestionnaires de missions", { timeout: 180000 }, () => {
  it("la liste des gestionnaires est admin, logistique, secrétariat", () => {
    expect([...MISSION_MANAGER_ROLES].sort()).toEqual(["admin", "logistics", "secretary"]);
  });

  it("au moins le chauffeur, la direction et le client sont refusés", () => {
    expect(REFUSED_ROLES).toEqual(expect.arrayContaining(["driver", "management", "client"]));
  });

  it.each(REFUSED_ROLES)(
    "%s : 403 sans aucune écriture (coût carburant, budgets, dates, chauffeur, véhicule)",
    async (actor) => {
      const before = await snapshot();
      const res = await session.call("PATCH", `/api/missions/${missionId}`, { actor, body: hostileBody() });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(403);
      expect(await snapshot()).toEqual(before);
    },
  );

  // Contre-épreuve : le même corps passe pour un gestionnaire. Sans elle, un 403 ne prouverait
  // pas que la garde bloque une écriture qui aurait réellement eu lieu.
  it("le même corps est appliqué pour la logistique (200, coût, budgets, dates, chauffeur et véhicule changés)", async () => {
    const res = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: hostileBody() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await snapshot();
    expect(Number(after.estimatedFuelCost)).toBe(1);
    expect(after.pickupDate).toBe("2031-07-01T08:00:00.000Z");
    expect(after.driverId).toBe(otherDriverId);
    expect(after.vehicleId).toBe(otherVehicleId);
    expect(after.budgetPlan).toMatchObject({ fuelBudget: 1, roadExpensesBudget: 1, contingencyBudget: 1 });
  });

  it.each(["admin", "logistics", "secretary"] as const)("%s : 200 et modification enregistrée", async (actor) => {
    const note = uniqueTestToken(`note-${actor}`);
    const res = await session.call("PATCH", `/api/missions/${missionId}`, {
      actor,
      body: { specialInstructions: note },
    });
    expect(res.status, actor).toBe(200);
    expect((await snapshot()).specialInstructions).toBe(note);
  });
});
