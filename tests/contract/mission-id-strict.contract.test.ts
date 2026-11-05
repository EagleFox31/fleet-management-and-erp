import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Validation stricte de l'identifiant de mission : la cloison chauffeur de router.param ne laisse plus
 * passer un identifiant qu'elle ne sait pas lire (entier strict, chiffres seuls), sinon 400.
 */
const ACTORS = { driverA: "driver", driverB: "driver", logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let foreignId = 0;
let ownId = 0;

async function missionFor(userId: number) {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [d] = await db.insert(drivers).values({ userId, firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any).returning();
  driverIds.push(d.id);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MID"), pickupAddress: "A", deliveryAddress: "B", status: "assigned" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId: d.id, status: "accepted" } as any);
  return m;
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [a, b] = await Promise.all([missionFor(session.userIdOf("driverA")), missionFor(session.userIdOf("driverB"))]);
  ownId = a.id;
  foreignId = b.id;
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

const PATHS = (id: string) => [`/api/missions/${id}`, `/api/missions/${id}/fuel-records`, `/api/missions/${id}/document-renewal-requests`];

describe("identifiant de mission strict", { timeout: 120000 }, () => {
  for (const suffix of ["abc", "-x", ".5", "e0", "%20"]) {
    it(`chauffeur, mission hors périmètre + suffixe « ${suffix} » : refus, aucun champ de mission`, async () => {
      for (const path of PATHS(`${foreignId}${suffix}`)) {
        const res = await session.call("GET", path, { actor: "driverA" });
        expect([400, 403], `${path} -> ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain("orderNumber");
      }
    });
  }

  it("identifiant non numérique, même pour le personnel : 400", async () => {
    for (const bad of ["abc", `${ownId}abc`, "1.5", "0"]) {
      const res = await session.call("GET", `/api/missions/${bad}`, { actor: "logistics" });
      expect(res.status, `${bad} -> ${JSON.stringify(res.body)}`).toBe(400);
    }
  });

  it("non-régression : sa propre mission reste lisible, la mission d'un autre reste refusée", async () => {
    expect((await session.call("GET", `/api/missions/${ownId}`, { actor: "driverA" })).status).toBe(200);
    expect((await session.call("GET", `/api/missions/${foreignId}`, { actor: "driverA" })).status).toBe(403);
  });
});
