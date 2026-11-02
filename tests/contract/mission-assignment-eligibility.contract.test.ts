import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, MIS1 : éligibilité du véhicule à l'affectation.
 * `POST /api/missions` refuse un véhicule en maintenance (getMissionEligibility).
 * `PATCH /api/missions/:id` doit refuser de même : c'est le chemin de l'écran « Modifier ».
 *
 * Défaut corrigé (MIS1-API-1) : le PATCH (bloc d'affectation de `router.patch("/:id")`) appelle
 * désormais getMissionEligibility comme le POST ; le cas « avec affectation » est un test ordinaire.
 */

const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let clientId: number;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

async function driver() {
  const [d] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      employeeNumber: uniqueTestToken("emp"),
      cpcStatus: "FORMÉ",
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

async function plannedMission() {
  const res = await call("POST", "/api/missions", {
    actor: "logistics",
    body: {
      orderNumber: uniqueTestToken("MIS"),
      clientId,
      status: "planned",
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
    },
  });
  expect(res.status).toBe(201);
  missionIds.push(res.body.id);
  return res.body.id as number;
}

describe("MIS1 : un véhicule en maintenance n'est pas affectable", () => {
  it("POST avec affectation : refusé en 400", async () => {
    const vehicle = await createTestVehicle({ status: "maintenance" });
    ids.vehicleIds.push(vehicle.id);
    const d = await driver();
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
    expect(res.status).toBe(400);
  });

  describe("PATCH", () => {
    let missionId: number;
    let vehicleId: number;
    let driverId: number;

    beforeAll(async () => {
      const vehicle = await createTestVehicle({ status: "maintenance" });
      ids.vehicleIds.push(vehicle.id);
      vehicleId = vehicle.id;
      driverId = (await driver()).id;
      missionId = await plannedMission();
    }, 60000);

    // Témoin : même PATCH, véhicule disponible, accepté et affectation écrite. Il prouve que le
    // refus ci-dessous vient de l'éligibilité et non d'un 403 ou d'un 500 sur la route.
    it("témoin : avec un véhicule disponible, accepté et affectation créée", async () => {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      const okDriverId = (await driver()).id;
      const okMissionId = await plannedMission();
      const res = await call("PATCH", `/api/missions/${okMissionId}`, {
        actor: "logistics",
        body: { assignment: { vehicleId: vehicle.id, driverId: okDriverId } },
      });
      expect(res.status).toBe(200);
      const rows = await db.select().from(assignments).where(inArray(assignments.missionId, [okMissionId]));
      expect(rows.map((r) => r.vehicleId)).toContain(vehicle.id);
    }, 60000); // crée véhicule, chauffeur et mission sur Neon : le délai par défaut (5 s) ne suffit pas

    it("avec affectation : refusé en 400", async () => {
      const res = await call("PATCH", `/api/missions/${missionId}`, {
        actor: "logistics",
        body: { assignment: { vehicleId, driverId } },
      });
      expect(res.status).toBe(400);
    });
  });
});
