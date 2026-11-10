import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * `GET /api/drivers/me` : une fiche chauffeur peut être liée à n'importe quel compte (`drivers.userId`).
 * Un technicien ou un client lié à une fiche ne reçoit ni la fiche ni les missions (adresses, client) :
 * 403 sans aucune de ces données. Le chauffeur et le personnel lecteur des missions gardent la route.
 */
type Actor = "driver" | "technician" | "client" | "logistics";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const driverIds: number[] = [];
const missionIds: number[] = [];
const PICKUP = uniqueTestToken("ADR-ENLEV");
const DELIVERY = uniqueTestToken("ADR-LIVR");
const LAST_NAME = uniqueTestToken("fiche");

async function linkedDriverWithMission(userId: number) {
  const [driver] = await db.insert(drivers).values({ firstName: "Test", lastName: LAST_NAME, userId } as any).returning({ id: drivers.id });
  driverIds.push(driver.id);
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: PICKUP, deliveryAddress: DELIVERY, status: "in_progress" } as any)
    .returning({ id: missions.id });
  missionIds.push(mission.id);
  await db.insert(assignments).values({ missionId: mission.id, driverId: driver.id, status: "accepted" } as any);
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ driver: "driver", technician: "technician", client: "client", logistics: "logistics" });
  for (const actor of ["driver", "technician", "client", "logistics"] as const) await linkedDriverWithMission(session.userId(actor));
}, 60000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await session.stop();
});

describe("GET /api/drivers/me : lecteurs des missions seulement", { timeout: 60000 }, () => {
  it.each(["technician", "client"] as const)("%s lié à une fiche : 403, ni fiche ni mission dans le refus", async (actor) => {
    const res = await session.call("GET", "/api/drivers/me", { actor });
    expect(res.status).toBe(403);
    const sent = JSON.stringify(res.body);
    for (const value of [PICKUP, DELIVERY, LAST_NAME]) expect(sent).not.toContain(value);
  });

  it.each(["driver", "logistics"] as const)("%s lié à une fiche : sa fiche et sa mission", async (actor) => {
    const res = await session.call("GET", "/api/drivers/me", { actor });
    expect(res.status).toBe(200);
    expect(res.body.driver.lastName).toBe(LAST_NAME);
    expect(res.body.missions.map((m: any) => m.pickupAddress)).toEqual([PICKUP]);
  });

  it("sans cookie : 401", async () => {
    const res = await session.call("GET", "/api/drivers/me", { actor: null });
    expect(res.status).toBe(401);
  });
});
