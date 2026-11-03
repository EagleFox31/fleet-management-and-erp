import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";

/**
 * Lectures carburant du personnel sur tout le parc. `storage.getVehicles()` sans
 * argument paginait à 10 : un véhicule hors des 10 plus récents disparaissait des
 * pleins et des statistiques, sans erreur.
 */
type Actor = "admin";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const recordIds: number[] = [];
let oldVehicleId = 0;
let recordId = 0;

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin" });
  const old = await createTestVehicle();
  oldVehicleId = old.id;
  session.ids.vehicleIds.push(old.id);
  const [row] = await db
    .insert(fuelRecords)
    .values({
      vehicleId: old.id,
      date: new Date().toISOString().slice(0, 10),
      quantity: 42,
      cost: "29400",
      mileage: 100500,
      validationStatus: "validated",
    })
    .returning();
  recordId = row.id;
  recordIds.push(row.id);
  // Dix véhicules plus récents : l'ancien sort de la première page de 10.
  for (let i = 0; i < 10; i++) session.ids.vehicleIds.push((await createTestVehicle()).id);
}, 120000);

afterAll(async () => {
  if (recordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, recordIds));
  await session.stop();
});

describe("carburant, personnel : tout le parc, pas les 10 derniers véhicules", { timeout: 120000 }, () => {
  it("GET /api/fuel-records contient le plein d'un véhicule hors des 10 plus récents", async () => {
    const res = await session.call("GET", "/api/fuel-records", { actor: "admin" });
    expect(res.status).toBe(200);
    expect((res.body as Array<{ id: number }>).map((r) => r.id)).toContain(recordId);
  });

  it("GET /api/fuel-records/statistics compte ce véhicule", async () => {
    const res = await session.call("GET", "/api/fuel-records/statistics?period=month", { actor: "admin" });
    expect(res.status).toBe(200);
    const mine = (res.body.vehicleStats as Array<{ vehicleId: number; fuel: number }>).find((s) => s.vehicleId === oldVehicleId);
    expect(mine?.fuel).toBe(42);
  });
});
