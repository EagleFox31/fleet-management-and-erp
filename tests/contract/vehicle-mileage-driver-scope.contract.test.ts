import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { IDEMPOTENCY_HEADER } from "../../server/lib/idempotency-config";
import { assignments, drivers, idempotencyKeys, missions, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lot kilométrage chauffeur (option A) : un chauffeur ne saisit le kilométrage que du véhicule
 * de son affectation active ; après clôture de l'affectation, plus rien. Le personnel saisit
 * sur tout véhicule. Un refus n'écrit rien : ni kilométrage, ni clé d'idempotence.
 */

const ACTORS = { driver: "driver", unlinked: "driver", logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const MESSAGE = "Vous ne pouvez saisir le kilométrage que du véhicule qui vous est affecté.";
const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const previousFlags = process.env.FEATURE_FLAGS;
const FUTURE = "2099-01-01";
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

async function put(vehicleId: number, kilometers: number, actor: Actor, key?: string) {
  const res = await fetch(`${session.baseUrl}/api/vehicles/${vehicleId}/mileage`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies.get(actor)!,
      ...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
    },
    body: JSON.stringify({ kilometers }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function newVehicle() {
  const v = await createTestVehicle({});
  ids.vehicleIds.push(v.id);
  await db
    .update(vehicles)
    .set({ insuranceExpiry: FUTURE, technicalInspectionDate: FUTURE, licensePlateExpiry: FUTURE, mileage: 100, lastMileage: 100, currentKilometers: 100 } as any)
    .where(eq(vehicles.id, v.id));
  return v;
}

/** Véhicule affecté au chauffeur, affectation au statut donné. */
let driverId: number | undefined;
/** Une seule fiche par compte (#113, `uq_drivers_user_id`). */
async function driverFiche() {
  if (driverId !== undefined) return driverId;
  const [driver] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(driver.id);
  return (driverId = driver.id);
}

async function vehicleAssignedToDriver(assignmentStatus: string) {
  const vehicle = await newVehicle();
  const driver = { id: await driverFiche() };
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "in_progress" } as any)
    .returning();
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: assignmentStatus } as any);
  return vehicle;
}

async function mileageOf(vehicleId: number) {
  const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicleId));
  return row.mileage;
}

async function keyRow(key: string, actor: Actor = "driver") {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, session.userIdOf(actor)), eq(idempotencyKeys.key, key)));
  return row;
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "offline-writes=on";
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("Kilométrage : un chauffeur ne saisit que son véhicule affecté", { timeout: 120000 }, () => {
  it("véhicule d'un autre : 403 lisible, kilométrage et clé inchangés", async () => {
    await vehicleAssignedToDriver("in_progress");
    const other = await newVehicle();
    const key = uniqueTestToken("km");

    const res = await put(other.id, 1000, "driver", key);
    expect(res.status).toBe(403);
    expect(res.body?.message).toBe(MESSAGE);
    expect(await mileageOf(other.id)).toBe(100);
    expect(await keyRow(key)).toBeUndefined();
  });

  it("son véhicule, affectation active : 200, kilométrage écrit", async () => {
    const own = await vehicleAssignedToDriver("accepted");
    const res = await put(own.id, 1000, "driver");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await mileageOf(own.id)).toBe(1000);
  });

  it("après clôture de l'affectation : 403, kilométrage inchangé", async () => {
    const closed = await vehicleAssignedToDriver("completed");
    const res = await put(closed.id, 1000, "driver");
    expect(res.status).toBe(403);
    expect(res.body?.message).toBe(MESSAGE);
    expect(await mileageOf(closed.id)).toBe(100);
  });

  it("compte chauffeur sans fiche : 403 lisible, kilométrage et clé inchangés", async () => {
    // Véhicule bien affecté, mais à la fiche d'un autre compte : sans fiche, aucun véhicule n'est le sien.
    const assigned = await vehicleAssignedToDriver("in_progress");
    const key = uniqueTestToken("km");

    const res = await put(assigned.id, 1000, "unlinked", key);
    expect(res.status).toBe(403);
    expect(res.body?.message).toBe(MESSAGE);
    expect(await mileageOf(assigned.id)).toBe(100);
    expect(await keyRow(key, "unlinked")).toBeUndefined();
  });

  it("personnel : 200 sur un véhicule sans affectation", async () => {
    const any = await newVehicle();
    const res = await put(any.id, 1000, "logistics");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await mileageOf(any.id)).toBe(1000);
  });
});
