import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { ownerScopeOf } from "../../server/lib/client-scope";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { createTestUser, createTestVehicle } from "../support/factories";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * R-03 : `GET /api/fuel-card/stats-by-client` cloisonné. La route est déjà fermée aux clients
 * par le montage (`isStaff`) ; le service porte la cloison en profondeur : avec un propriétaire,
 * seuls les pleins de ses véhicules sont comptés.
 */
const ids = createIdBag();
const recordIds: number[] = [];

afterAll(async () => {
  if (recordIds.length > 0) await deleteFuelRecordsWhere(inArray(fuelRecords.id, recordIds));
  await cleanupCreated(ids);
});

async function fill(vehicleId: number, station: string, debit: number) {
  const [row] = await db
    .insert(fuelRecords)
    .values({ vehicleId, quantity: 10, stationName: station, debitAmount: String(debit), date: "2031-05-05" })
    .returning();
  recordIds.push(row.id);
}

describe("fuelCardService.getStatsByClient : cloison client", () => {
  it("un client ne compte que ses véhicules, le personnel compte tout", async () => {
    const client = await createTestUser({ role: "client" });
    ids.userIds.push(client.id);
    const mine = await createTestVehicle({ ownerId: client.id });
    const others = await createTestVehicle();
    ids.vehicleIds.push(mine.id, others.id);
    const stationA = uniqueTestToken("stA");
    const stationB = uniqueTestToken("stB");
    await fill(mine.id, stationA, 1000);
    await fill(others.id, stationB, 2000);

    const asClient = await fuelCardService.getStatsByClient(ownerScopeOf({ id: client.id, role: "client" }));
    expect(asClient.map((r) => r.clientName)).toEqual([stationA]);
    expect(asClient[0].totalCost).toBe(1000);

    const asStaff = await fuelCardService.getStatsByClient(ownerScopeOf({ id: 1, role: "admin" }));
    const names = asStaff.map((r) => r.clientName);
    expect(names).toContain(stationA);
    expect(names).toContain(stationB);
  });

  it("un client sans véhicule ne voit rien", async () => {
    const client = await createTestUser({ role: "client" });
    ids.userIds.push(client.id);
    expect(await fuelCardService.getStatsByClient(client.id)).toEqual([]);
  });
});
