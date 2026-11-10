import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { drivers } from "../../shared/schema";
import { driversLinkedOutsideMissionReaders } from "../../server/lib/driver-link";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Recensement des liaisons antérieures à la règle (fiche liée à un compte hors `MISSION_READ_ROLES`) :
 * technicien et client listés, chauffeur et personnel lecteur non ; lecture seule, aucune liaison modifiée.
 */
const ids = createIdBag();
const driverIds: number[] = [];
const byRole: Record<string, { userId: number; driverId: number }> = {};

beforeAll(async () => {
  for (const role of ["technician", "client", "driver", "logistics"] as const) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    // Insertion directe : simule une liaison posée avant la règle, que l'API refuse désormais.
    const [row] = await db.insert(drivers).values({ firstName: "Test", lastName: uniqueTestToken("audit"), userId: user.id } as any).returning({ id: drivers.id });
    driverIds.push(row.id);
    byRole[role] = { userId: user.id, driverId: row.id };
  }
});

afterAll(async () => {
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
});

describe("driversLinkedOutsideMissionReaders", () => {
  it("liste technicien et client, pas le chauffeur ni le personnel lecteur, sans rien modifier", async () => {
    const mine = (await driversLinkedOutsideMissionReaders()).filter((row) => driverIds.includes(row.driverId));
    expect(mine).toEqual([
      { driverId: byRole.technician.driverId, userId: byRole.technician.userId, role: "technician" },
      { driverId: byRole.client.driverId, userId: byRole.client.userId, role: "client" },
    ]);
    for (const { userId, driverId } of Object.values(byRole)) {
      const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, driverId));
      expect(row.userId).toBe(userId);
    }
  });
});
