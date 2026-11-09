import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { workOrders } from "../../shared/schema";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * #599 (relecture) : `getWorkOrders` triait par `createdAt` seul. Des OT de même date de
 * création (import en masse) n'avaient pas d'ordre stable entre deux pages : un OT pouvait
 * revenir sur deux pages et un autre être sauté, alors que le rapport des coûts lit tout
 * page par page. Départage par `id` décroissant.
 */
const ids = createIdBag();
const created: number[] = [];
const SAME_DATE = new Date("2099-01-01T08:00:00Z");

beforeAll(async () => {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const rows = await db
    .insert(workOrders)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        vehicleId: vehicle.id,
        title: `OT même date ${i}`,
        status: "pending" as const,
        priority: "low" as const,
        createdAt: SAME_DATE,
      })) as (typeof workOrders.$inferInsert)[],
    )
    .returning({ id: workOrders.id });
  created.push(...rows.map((r) => r.id));
}, 60_000);

afterAll(async () => {
  if (created.length) await db.delete(workOrders).where(inArray(workOrders.id, created));
  await cleanupCreated(ids);
});

describe("liste des OT : pagination stable à date de création égale", { timeout: 60_000 }, () => {
  it("page par page, chaque OT sort une fois, par id décroissant", async () => {
    const seen: number[] = [];
    for (let offset = 0; offset < created.length; offset++) {
      const page = await storage.getWorkOrders(undefined, undefined, 1, offset);
      seen.push(...page.workOrders.map((w: { id: number }) => w.id));
    }
    expect(seen).toEqual([...created].sort((a, b) => b - a));
  });
});
