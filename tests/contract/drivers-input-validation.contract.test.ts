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
 * Saisie des fiches chauffeur (drivers-management.routes.ts) :
 * - une date au bon format mais impossible (9999-99-99) donne 400, pas 500 ;
 * - le corps de validation ne renvoie jamais la valeur reçue ;
 * - un PATCH ne peut pas écrire le statut CPC : la garde d'affectation lit ce statut.
 */

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<"logistics">>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

async function newDriver(cpcStatus: string, cpcTrainingDate: string | null = null) {
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
  session = await startContractActors<"logistics">({ logistics: "logistics" }, ids.userIds);
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

describe("dates impossibles", () => {
  for (const field of ["licenseExpiry", "cpcTrainingDate", "hireDate"]) {
    it(`PATCH ${field} : 9999-99-99 donne 400 avec un message dédié`, async () => {
      const d = await newDriver("NON FORMÉ");
      const res = await call("PATCH", `/api/drivers/${d.id}`, { actor: "logistics", body: { [field]: "9999-99-99" } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
      expect(res.body.message).toBe("Date inexistante : vérifiez le jour et le mois");
      expect(leakText(res.body)).not.toMatch(/SQLSTATE|invalid input syntax|out of range/i);
    }, 60000);
  }

  it("POST : 2026-02-30 donne 400", async () => {
    const res = await call("POST", "/api/drivers", {
      actor: "logistics",
      body: { firstName: "TEST", lastName: uniqueTestToken("drv"), licenseExpiry: "2026-02-30" },
    });
    if (res.status === 201) driverIds.push(res.body.id);
    expect(res.status).toBe(400);
  }, 60000);
});

describe("corps de validation", () => {
  it("ne renvoie jamais la valeur reçue dans un champ invalide", async () => {
    const d = await newDriver("NON FORMÉ");
    const marker = `MARQUEUR-${uniqueTestToken("leak")}`;
    for (const field of ["licenseExpiry", "cniExpiry", "birthDate", "cpcTrainingDate"]) {
      const res = await call("PATCH", `/api/drivers/${d.id}`, { actor: "logistics", body: { [field]: marker } });
      expect(res.status, field).toBe(400);
      expect(leakText(res.body), field).not.toContain(marker);
    }
    const created = await call("POST", "/api/drivers", {
      actor: "logistics",
      body: { firstName: marker, lastName: "", licenseExpiry: marker },
    });
    expect(created.status).toBe(400);
    expect(leakText(created.body)).not.toContain(marker);
  }, 60000);
});

describe("statut CPC et PATCH de la fiche", () => {
  it("PATCH {cpcStatus FORMÉ, cpcTrainingDate null} : le statut reste NON FORMÉ et la mission est refusée", async () => {
    const d = await newDriver("NON FORMÉ");
    const res = await call("PATCH", `/api/drivers/${d.id}`, {
      actor: "logistics",
      body: { cpcStatus: "FORMÉ", cpcTrainingDate: null },
    });
    expect(res.status).toBeLessThan(500);
    const [row] = await db.select({ cpcStatus: drivers.cpcStatus }).from(drivers).where(eq(drivers.id, d.id));
    expect(row.cpcStatus).toBe("NON FORMÉ");

    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const mission = await call("POST", "/api/missions", {
      actor: "logistics",
      body: {
        orderNumber: uniqueTestToken("MIS"),
        clientId: client.id,
        status: "planned",
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        assignment: { vehicleId: vehicle.id, driverId: d.id },
      },
    });
    if (mission.status === 201) missionIds.push(mission.body.id);
    expect(mission.status).toBe(400);
  }, 60000);
});
