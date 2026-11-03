import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * FUEL2, consommation par véhicule : `GET /api/fuel-card/vehicle/:id/stats`.
 * Les totaux ne comptent que les pleins débités (`debit_amount > 0`) du véhicule demandé.
 */

type Actor = "admin" | "driver" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const recordIds: number[] = [];

async function record(vehicleId: number, quantity: number, debitAmount: number | null, stationName: string) {
  const [row] = await db
    .insert(fuelRecords)
    .values({ vehicleId, quantity, debitAmount: debitAmount === null ? null : String(debitAmount), stationName, validationStatus: "validated" })
    .returning();
  recordIds.push(row.id);
}

async function newVehicle() {
  const vehicle = await createTestVehicle();
  session.ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin", driver: "driver", client: "client" });
}, 60000);

afterAll(async () => {
  if (recordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, recordIds));
  await session.stop();
});

describe("FUEL2 : statistiques de consommation d'un véhicule", { timeout: 60000 }, () => {
  it("cumule litres, coût et prix moyen au litre, station principale en tête", async () => {
    const vehicle = await newVehicle();
    const s1 = uniqueTestToken("sta");
    const s2 = uniqueTestToken("sta");
    await record(vehicle.id, 100, 70000, s1);
    await record(vehicle.id, 50, 35000, s1);
    await record(vehicle.id, 50, 40000, s2);

    const res = await session.call("GET", `/api/fuel-card/vehicle/${vehicle.id}/stats`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      vehicleId: vehicle.id,
      vehicleRegistration: vehicle.registrationNumber,
      totalLiters: 200,
      totalCost: 145000,
      recordsCount: 3,
      averagePricePerLiter: 725,
    });
    expect(res.body.averageQuantity).toBeCloseTo(200 / 3, 5);
    expect(res.body.mainStations[0]).toEqual({ name: s1, count: 2 });
  });

  it("ignore les pleins sans débit et ceux des autres véhicules", async () => {
    const vehicle = await newVehicle();
    const other = await newVehicle();
    await record(vehicle.id, 40, 28000, "TEST A");
    await record(vehicle.id, 500, null, "TEST sans débit");
    await record(vehicle.id, 500, 0, "TEST débit nul");
    await record(other.id, 999, 999000, "TEST autre véhicule");

    const res = await session.call("GET", `/api/fuel-card/vehicle/${vehicle.id}/stats`, { actor: "admin" });
    expect(res.body).toMatchObject({ totalLiters: 40, totalCost: 28000, recordsCount: 1, averagePricePerLiter: 700 });
  });

  it("un véhicule sans plein renvoie des zéros, jamais NaN", async () => {
    const vehicle = await newVehicle();
    const res = await session.call("GET", `/api/fuel-card/vehicle/${vehicle.id}/stats`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalLiters: 0, totalCost: 0, recordsCount: 0, averagePricePerLiter: 0, mainStations: [] });
  });

  it("refuse sans session (401) et à un client (403), laisse lire le personnel", async () => {
    const vehicle = await newVehicle();
    const path = `/api/fuel-card/vehicle/${vehicle.id}/stats`;
    expect((await session.call("GET", path, { actor: null })).status).toBe(401);
    expect((await session.call("GET", path, { actor: "client" })).status).toBe(403);
    expect((await session.call("GET", path, { actor: "driver" })).status).toBe(200);
  });

  it("répond 400 à un identifiant illisible", async () => {
    expect((await session.call("GET", "/api/fuel-card/vehicle/abc/stats", { actor: "admin" })).status).toBe(400);
  });

  // Véhicule inconnu : 404 lisible (le service lève VEHICLE_NOT_FOUND, traduit en AppError).
  it("un véhicule inconnu répond 404, pas 500", async () => {
    const res = await session.call("GET", "/api/fuel-card/vehicle/2147483000/stats", { actor: "admin" });
    expect(res.status).toBe(404);
    expect(leakText(res.body)).not.toMatch(/2147483000|SELECT/);
  });
});
