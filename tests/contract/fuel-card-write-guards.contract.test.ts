import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { getFuelPriceAt } from "../../server/services/fuel-price-service";
import { assignments, drivers, fuelRecords, missions } from "../../shared/schema";
import { apiErrorProblems, leakText } from "../support/api-error";
import { cleanupCreated, createIdBag, deleteTreasuryEntriesOfMissions } from "../support/cleanup";
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
  thirdDriver: "driver",
  technician: "technician",
  workshop_manager: "workshop_manager",
  warehouse: "warehouse",
  management: "management",
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
    await deleteTreasuryEntriesOfMissions(missionIds);
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("POST /api/missions/:id/fuel-records : rôles", { timeout: 180000 }, () => {
  it.each(["technician", "workshop_manager", "warehouse", "management"] as const)("%s : 403, aucun débit, solde inchangé", async (actor) => {
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

  it("chauffeur non affecté avec un vehicleId faux : 403 et non 400 (aucune fuite du véhicule affecté)", async () => {
    const { missionId } = await missionOfDriver("driver");
    const other = await fundedVehicle();
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(other) });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
  });

  // Une mission peut avoir plusieurs chauffeurs (#227) : le chauffeur présent sur une seconde affectation
  // est autorisé, et son véhicule contrôlé est celui de SA ligne. Un véhicule faux est donc un 400 (il ne
  // trahit aucun véhicule : l'appelant est affecté), et plus un 403 comme quand la première ligne lue
  // décidait pour tous.
  it("chauffeur sur une seconde affectation avec un vehicleId faux : 400, aucun débit", async () => {
    const { missionId } = await missionOfDriver("otherDriver");
    const second = await fundedVehicle();
    await db.insert(assignments).values({ missionId, vehicleId: second, driverId: await driverFiche("driver"), status: "accepted" } as any);
    const wrong = await fundedVehicle();
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(wrong) });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
  });

  it("chauffeur retiré de la mission par PATCH : 403, aucun débit", async () => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const patch = await session.call("PATCH", `/api/missions/${missionId}`, {
      actor: "logistics",
      body: { assignment: { vehicleId, driverId: await driverFiche("otherDriver") } },
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const before = await balance(vehicleId);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleId) });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("chauffeur affecté avec un vehicleId différent : 400, aucun débit", async () => {
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const other = await fundedVehicle();
    const before = await balance(vehicleId);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(other) });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("chauffeur affecté avec un unitPrice arbitraire : débité au prix du jour", async () => {
    const official = await getFuelPriceAt(TODAY);
    const { missionId, vehicleId } = await missionOfDriver("driver");
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: { ...fill(vehicleId), unitPrice: 1 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.missionId, missionId));
    expect(Number(row.debitAmount)).toBeCloseTo(2 * official, 2);
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
    ["quantity non numérique", { quantity: "abc" }, "La quantité doit être un nombre positif.", "quantity"],
    ["unitPrice absent", { unitPrice: undefined }, "Données de consommation incomplètes", "unitPrice"],
    ["vehicleId non numérique", { vehicleId: "abc" }, "Identifiant de véhicule invalide.", "vehicleId"],
    ["quantity négative", { quantity: -3 }, "La quantité doit être un nombre positif.", "quantity"],
    ["quantity vide", { quantity: "" }, "La quantité doit être un nombre positif.", "quantity"],
    ["stationName absent", { stationName: undefined }, "Données de consommation incomplètes", "stationName"],
  ])("%s : 400 lisible avec errors, sans détail technique, solde inchangé", async (_label, over, message, field) => {
    const vehicleId = await fundedVehicle();
    const before = await balance(vehicleId);
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: { ...valid(vehicleId), ...over } });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toBe(message);
    expect(res.body.errors).toEqual([{ field, message }]);
    expect(leakText(res.body)).not.toMatch(/NaN|ZodError|invalid_type/);
    expect(await balance(vehicleId)).toBe(before);
  });

  it("clientName et notes à null acceptés comme avant", async () => {
    const vehicleId = await fundedVehicle();
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: { ...valid(vehicleId), clientName: null, notes: null } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("corps valide : 201 (non-régression)", async () => {
    const vehicleId = await fundedVehicle();
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: { ...valid(vehicleId), quantity: "2" } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

/** Mission à deux chauffeurs, un véhicule chacun : A = driver (1re ligne), B = otherDriver (2e ligne). */
async function twoDriverMission() {
  const a = await missionOfDriver("driver");
  const vehicleB = await fundedVehicle();
  const [rowB] = await db
    .insert(assignments)
    .values({ missionId: a.missionId, vehicleId: vehicleB, driverId: await driverFiche("otherDriver"), status: "accepted" } as any)
    .returning();
  return { missionId: a.missionId, vehicleA: a.vehicleId, vehicleB, assignmentB: rowB.id };
}

describe("POST /api/missions/:id/fuel-records : plusieurs chauffeurs par mission (#227)", { timeout: 180000 }, () => {
  it("A et B saisissent chacun leur carburant : 201 pour les deux, débit sur leur propre véhicule", async () => {
    const { missionId, vehicleA, vehicleB } = await twoDriverMission();
    const beforeA = await balance(vehicleA);
    const beforeB = await balance(vehicleB);

    const resA = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleA) });
    expect(resA.status, JSON.stringify(resA.body)).toBe(201);
    const resB = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleB) });
    expect(resB.status, JSON.stringify(resB.body)).toBe(201);

    expect(await recordsOf(missionId)).toBe(2);
    expect(await balance(vehicleA)).toBeLessThan(beforeA);
    expect(await balance(vehicleB)).toBeLessThan(beforeB);
    const rows = await db.select().from(fuelRecords).where(eq(fuelRecords.missionId, missionId));
    expect(rows.filter((r) => Number(r.debitAmount ?? 0) > 0).map((r) => r.vehicleId).sort()).toEqual([vehicleA, vehicleB].sort());
  });

  it("B envoie le vehicleId de A : 400, aucun débit (le véhicule contrôlé est celui de sa propre affectation)", async () => {
    const { missionId, vehicleA, vehicleB } = await twoDriverMission();
    const beforeA = await balance(vehicleA);
    const beforeB = await balance(vehicleB);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleA) });
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleA)).toBe(beforeA);
    expect(await balance(vehicleB)).toBe(beforeB);
  });

  it("chauffeur C hors mission : 403, aucun débit", async () => {
    const { missionId, vehicleA, vehicleB } = await twoDriverMission();
    await driverFiche("thirdDriver");
    for (const vehicleId of [vehicleA, vehicleB]) {
      const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "thirdDriver", body: fill(vehicleId) });
      expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    }
    expect(await recordsOf(missionId)).toBe(0);
  });

  it.each(["cancelled", "rejected"] as const)("affectation %s : aucun droit, 403 sans débit (l'autre chauffeur reste accepté)", async (status) => {
    const { missionId, vehicleB, assignmentB } = await twoDriverMission();
    await db.update(assignments).set({ status } as any).where(eq(assignments.id, assignmentB));
    const before = await balance(vehicleB);
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleB) });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(0);
    expect(await balance(vehicleB)).toBe(before);
  });

  it("le personnel saisit pour n'importe lequel des véhicules de la mission, et la régularisation aussi", async () => {
    const { missionId, vehicleA, vehicleB } = await twoDriverMission();
    for (const vehicleId of [vehicleA, vehicleB]) {
      const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "logistics", body: fill(vehicleId) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    const foreign = await fundedVehicle();
    const refused = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "logistics", body: fill(foreign) });
    expect(apiErrorProblems(refused.status, refused.body, 400, undefined, refused.headers.get("x-request-id"))).toEqual([]);
    expect(await recordsOf(missionId)).toBe(2);
  });

  it("GET /api/missions/:id : le chauffeur B lit sa propre affectation, jamais celle de A ; le personnel lit les deux", async () => {
    const { missionId, vehicleA, vehicleB } = await twoDriverMission();
    const asB = await session.call("GET", `/api/missions/${missionId}`, { actor: "otherDriver" });
    expect(asB.status, JSON.stringify(asB.body)).toBe(200);
    expect(asB.body.assignment.vehicleId).toBe(vehicleB);
    expect(asB.body.assignments.map((a: any) => a.vehicleId)).toEqual([vehicleB]);

    const asStaff = await session.call("GET", `/api/missions/${missionId}`, { actor: "logistics" });
    expect(asStaff.body.assignment.vehicleId).toBe(vehicleA);
    expect(asStaff.body.assignments.map((a: any) => a.vehicleId)).toEqual([vehicleA, vehicleB]);
  });

  it("les listes d'opérations ne dupliquent pas une mission à deux affectations", async () => {
    const { missionId } = await twoDriverMission();
    const all = await session.call("GET", "/api/operations/missions?status=in_progress", { actor: "logistics" });
    expect(all.status).toBe(200);
    expect(all.body.filter((m: any) => m.id === missionId)).toHaveLength(1);
    const active = await session.call("GET", "/api/operations/missions/active", { actor: "logistics" });
    expect(active.body.filter((m: any) => m.id === missionId)).toHaveLength(1);
  });

  // Décision du 3 novembre 2026 : un plein appartient à la mission et au camion, pas au chauffeur.
  // Les co-chauffeurs se relaient : chacun lit tous les pleins de la mission.
  it("GET /api/missions/:id/fuel-records : B lit le plein saisi par A sur la même mission", async () => {
    const { missionId, vehicleA } = await twoDriverMission();
    const resA = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleA) });
    expect(resA.status, JSON.stringify(resA.body)).toBe(201);
    const asB = await session.call("GET", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver" });
    expect(asB.status, JSON.stringify(asB.body)).toBe(200);
    expect(asB.body.records.map((r: any) => r.vehicleId)).toContain(vehicleA);
  });

  it("relais sur le même camion : B saisit après un plein de A, 201, et la mission porte les deux pleins", async () => {
    const a = await missionOfDriver("driver");
    await db
      .insert(assignments)
      .values({ missionId: a.missionId, vehicleId: a.vehicleId, driverId: await driverFiche("otherDriver"), status: "accepted" } as any);
    const before = await balance(a.vehicleId);
    for (const actor of ["driver", "otherDriver"] as const) {
      const res = await session.call("POST", `/api/missions/${a.missionId}/fuel-records`, { actor, body: fill(a.vehicleId) });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(201);
    }
    expect(await recordsOf(a.missionId)).toBe(2);
    expect(await balance(a.vehicleId)).toBeLessThan(before);
    const asB = await session.call("GET", `/api/missions/${a.missionId}/fuel-records`, { actor: "otherDriver" });
    expect(asB.body.records).toHaveLength(2);
  });
});
