import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * `listAllVehicles` : tout le parc non supprimé, sans la pagination à 10 de
 * `getVehicles`. Voir `tests/unit/server/vehicles-unbounded-hygiene.test.ts`.
 */
const ids = createIdBag();

afterAll(async () => {
  await cleanupCreated(ids);
});

describe("storage.listAllVehicles", { timeout: 60000 }, () => {
  it("renvoie un véhicule ancien que la première page de getVehicles() ne contient pas, sans les supprimés", async () => {
    const oldest = await createTestVehicle();
    const deleted = await createTestVehicle();
    ids.vehicleIds.push(oldest.id, deleted.id);
    await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, deleted.id));
    for (let i = 0; i < 10; i++) ids.vehicleIds.push((await createTestVehicle()).id);

    const firstPage = await storage.getVehicles(undefined, undefined, undefined, 10, 0);
    expect(firstPage.vehicles.map((v) => v.id)).not.toContain(oldest.id);

    const all = await storage.listAllVehicles();
    const allIds = all.vehicles.map((v) => v.id);
    expect(allIds).toContain(oldest.id);
    expect(allIds).not.toContain(deleted.id);
    expect(all.total).toBe(all.vehicles.length);
    expect(all.total).toBe(firstPage.total);
  });
});
