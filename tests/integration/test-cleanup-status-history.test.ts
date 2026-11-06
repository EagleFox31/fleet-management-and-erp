import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { statusHistory, users } from "../../shared/schema";
import { cleanupCreated, cleanupOrphanTestRows, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

const ids = createIdBag();

afterEach(async () => {
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.vehicleIds.length = 0;
});

describe("ménage des restes de test : status_history", () => {
  it("supprime un compte de test orphelin qui a tracé un changement de statut", async () => {
    const user = await createTestUser({ role: "logistics" });
    ids.userIds.push(user.id);
    // Véhicule récent : il n'est pas orphelin, la cascade vehicle_id ne retire donc pas l'historique.
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    await db.insert(statusHistory).values({
      vehicleId: vehicle.id,
      status: "maintenance",
      date: "2026-01-01",
      updatedById: user.id,
    });
    await db.update(users).set({ createdAt: sql`now() - interval '3 hours'` }).where(eq(users.id, user.id));

    await expect(cleanupOrphanTestRows()).resolves.toBeUndefined();

    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await db.select().from(statusHistory).where(eq(statusHistory.updatedById, user.id))).toHaveLength(0);
  });

  it("supprime l'historique d'un compte de test suivi par cleanupCreated", async () => {
    const user = await createTestUser({ role: "logistics" });
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await db.insert(statusHistory).values({
      vehicleId: vehicle.id,
      status: "maintenance",
      date: "2026-01-01",
      updatedById: user.id,
    });

    await cleanupCreated({ ...createIdBag(), userIds: [user.id] });

    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
  });
});
