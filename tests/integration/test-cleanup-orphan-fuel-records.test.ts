import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { fuelRecords, vehicles } from "../../shared/schema";
import { cleanupCreated, cleanupOrphanTestRows, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.vehicleIds.length = 0;
  ids.fuelRecordIds.length = 0;
});

describe("ménage des restes de test : pleins d'un véhicule orphelin", () => {
  it("supprime le véhicule orphelin et ses pleins sans préfixe de test (FK fuel_records_vehicle_id)", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    // Notes sans préfixe TEST : le balayage par notes ne le voit pas.
    const [record] = await db.insert(fuelRecords).values({ vehicleId: vehicle.id, quantity: 40, notes: "plein libre" }).returning();
    ids.fuelRecordIds.push(record.id);
    await db.update(vehicles).set({ createdAt: sql`now() - interval '3 hours'` }).where(eq(vehicles.id, vehicle.id));

    await expect(cleanupOrphanTestRows()).resolves.toBeUndefined();

    expect(await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))).toHaveLength(0);
    expect(await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id))).toHaveLength(0);
  });
});
