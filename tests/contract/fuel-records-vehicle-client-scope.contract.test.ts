import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords, vehicles } from "../../shared/schema";
import { OUT_OF_SCOPE_MESSAGE } from "../../server/lib/client-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/**
 * GET /api/fuel-records/vehicle/:vehicleId (server/api/fuel-records.routes.ts), même cloison que les
 * autres lectures rattachées au véhicule :
 * - client propriétaire : ses pleins sur son véhicule actif, 403 une fois le véhicule retiré ;
 * - client tiers : 403, même message (le retrait ne se devine pas) ;
 * - personnel : 200, véhicule retiré compris ; sans session : 401 ; id illisible : 400.
 * Témoins : le montage ne masque pas les routes voisines de routes.ts (/api/fuel-records,
 * /statistics, /consumption-history).
 */
const ids = createIdBag();
let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "technician" | "owner" | "stranger">>>;
let active = 0;
let retired = 0;

const path = (id: number | string) => `/api/fuel-records/vehicle/${id}`;

async function addRecord(vehicleId: number) {
  const [row] = await db
    .insert(fuelRecords)
    .values({ vehicleId, date: "2026-10-01", quantity: 40, cost: "32000", mileage: 1000, notes: "contrat cloison pleins" })
    .returning({ id: fuelRecords.id });
  ids.fuelRecordIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  actors = await startContractActors(
    { admin: "admin", technician: "technician", owner: "client", stranger: "client" },
    ids.userIds,
  );
  const a = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  const r = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
  ids.vehicleIds.push(a.id, r.id);
  active = a.id;
  retired = r.id;
  await addRecord(active);
  await addRecord(retired);
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, retired));
}, 180000);

afterAll(async () => {
  try {
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

describe("pleins d'un véhicule : cloison client", { timeout: 60000 }, () => {
  it("propriétaire : ses pleins sur le véhicule actif, avec prix au litre et coût total", async () => {
    const res = await actors.call("GET", path(active), { actor: "owner" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ vehicleId: active, totalCost: 32000, pricePerLiter: 800 });
  });

  it("propriétaire d'un véhicule retiré : 403, aucun plein renvoyé", async () => {
    const res = await actors.call("GET", path(retired), { actor: "owner" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
  });

  it("client tiers : 403 sur le véhicule actif comme sur le retiré, même message", async () => {
    for (const id of [active, retired]) {
      const res = await actors.call("GET", path(id), { actor: "stranger" });
      expect(res.status, path(id)).toBe(403);
      expect(res.body.message).toBe(OUT_OF_SCOPE_MESSAGE);
    }
  });

  it("personnel : 200 sur le véhicule retiré, plein compris", async () => {
    for (const actor of ["admin", "technician"] as const) {
      const res = await actors.call("GET", path(retired), { actor });
      expect(res.status, `${actor} ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toHaveLength(1);
    }
  });

  it("sans session : 401 ; id illisible : 400", async () => {
    expect((await actors.call("GET", path(active), {})).status).toBe(401);
    expect((await actors.call("GET", path("12abc"), { actor: "owner" })).status).toBe(400);
  });
});

describe("montage : routes voisines de routes.ts intactes", { timeout: 60000 }, () => {
  it.each([
    "/api/fuel-records",
    "/api/fuel-records/statistics",
    "/api/fuel-records/consumption-history",
  ])("GET %s répond toujours", async (url) => {
    const res = await actors.call("GET", url, { actor: "admin" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
