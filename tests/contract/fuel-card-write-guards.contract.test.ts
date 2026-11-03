import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { assignments, drivers, fuelRecords, missions } from "../../shared/schema";
import { apiErrorProblems, leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Écritures qui débitent la carte carburant de l'entreprise :
 *  - POST /api/missions/:id/fuel-records : gestionnaires de mission (admin, logistics, secretary)
 *    et chauffeur affecté seulement. Un technicien, un magasinier ou un chef d'atelier recevait
 *    jusque-là 201 et le solde baissait.
 *  - POST /api/fuel-card/consumption : un corps invalide répond 400 lisible (quantity:"abc"
 *    donnait NaN puis une 500).
 */
const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  secretary: "secretary",
  driver: "driver",
  otherDriver: "driver",
  technician: "technician",
  workshop_manager: "workshop_manager",
  warehouse: "warehouse",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

async function fundedVehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const { balance } = await fuelCardService.getCurrentBalance();
  await createTestFuelRecord({
    vehicleId: v.id,
    creditAmount: (Math.max(0, -balance) + 10_000).toFixed(2),
    debitAmount: "0",
    cost: "0",
    quantity: 0,
  });
  return v.id;
}

const ficheOf = new Map<Actor, number>();
/** Une seule fiche par compte (`uq_drivers_user_id`). */
async function driverFiche(actor: Actor) {
  const known = ficheOf.get(actor);
  if (known !== undefined) return known;
  const [driver] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf(actor), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(driver.id);
  ficheOf.set(actor, driver.id);
  return driver.id;
}

async function missionOfDriver(driverActor: Actor) {
  const vehicleId = await fundedVehicle();
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("FGRD"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId, driverId: await driverFiche(driverActor), status: "accepted" } as any);
  return { missionId: m.id, vehicleId };
}

const fill = (vehicleId: number) => ({ vehicleId, quantity: 2, unitPrice: 1, date: TODAY, requestKey: uniqueTestToken("fgrd-key") });

/** Solde des lignes du véhicule du test (crédit - débit) : la carte est globale, un autre fichier peut la bouger. */
async function balance(vehicleId: number) {
  const rows = await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicleId));
  return rows.reduce((sum, r) => sum + Number(r.creditAmount ?? 0) - Number(r.debitAmount ?? 0), 0);
}

async function recordsOf(missionId: number) {
  return (await db.select().from(fuelRecords).where(eq(fuelRecords.missionId, missionId))).length;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("POST /api/missions/:id/fuel-records : rôles", { timeout: 180000 }, () => {
  it.each(["technician", "workshop_manager", "warehouse"] as const)("%s : 403, aucun débit, solde inchangé", async (actor) => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const before = await balance(vehicleId);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor, body: fill(vehicleId) });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("chauffeur non affecté : 403, aucun débit", async () => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const before = await balance(vehicleId);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleId) });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("chauffeur affecté : accepté, la carte est débitée", async () => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const before = await balance(vehicleId);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleId) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await recordsOf(missionId)).toBe(1);
    expect(await balance(vehicleId)).toBeLessThan(before);
  });

  it.each(["admin", "logistics", "secretary"] as const)("gestionnaire de mission %s : accepté", async (actor) => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor, body: fill(vehicleId) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await recordsOf(missionId)).toBe(1);
  });
});

describe("POST /api/fuel-card/consumption : corps invalide", { timeout: 180000 }, () => {
  const valid = (vehicleId: number) => ({
    vehicleId,
    quantity: 2,
    unitPrice: 1,
    date: TODAY,
    stationName: "TEST STATION",
    destination: "TEST DEST",
  });

  it.each([
    ["quantity non numérique", { quantity: "abc" }],
    ["unitPrice absent", { unitPrice: undefined }],
    ["vehicleId non numérique", { vehicleId: "abc" }],
    ["quantity négative", { quantity: -3 }],
    ["quantity vide", { quantity: "" }],
    ["stationName absent", { stationName: undefined }],
  ])("%s : 400 lisible, sans détail technique, solde inchangé", async (_label, over) => {
    const vehicleId = await fundedVehicle();
    const before = await balance(vehicleId);
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: { ...valid(vehicleId), ...over } });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe("Données de consommation invalides.");
    expect(leakText(res.body)).not.toMatch(/NaN|ZodError|invalid_type/);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("corps valide : 201 (non-régression)", async () => {
    const vehicleId = await fundedVehicle();
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: { ...valid(vehicleId), quantity: "2" } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
