import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { leakText } from "../support/api-error";
import { uniqueTestToken } from "../support/ids";

/**
 * GET /api/missions/:id/launch-readiness lit l'affectation vivante de la mission, pour le personnel
 * comme pour le chauffeur. Une affectation annulée ou refusée, même première par id, ne porte pas
 * la check-list : router.param cloisonne la mission, pas l'affectation lue.
 */

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<"logistics" | "driver">>>;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function newDriver(cpcTrainingDate: string) {
  const [d] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      employeeNumber: uniqueTestToken("emp"),
      cpcStatus: "FORMÉ",
      cpcTrainingDate,
      isActive: true,
    } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

async function missionWith(rows: Array<{ driverId: number; status: string }>) {
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("MIS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned" } as any)
    .returning();
  missionIds.push(m.id);
  for (const row of rows) await db.insert(assignments).values({ missionId: m.id, ...row } as any);
  return m.id;
}

beforeAll(async () => {
  session = await startContractActors({ logistics: "logistics", driver: "driver" } as const, ids.userIds);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("launch-readiness : seule l'affectation vivante porte la check-list", () => {
  for (const voidStatus of ["cancelled", "rejected"]) {
    it(`personnel : première affectation ${voidStatus}, la suivante vivante est lue`, async () => {
      const expired = await newDriver(daysAgo(800));
      const valid = await newDriver(daysAgo(100));
      const missionId = await missionWith([
        { driverId: expired.id, status: voidStatus },
        { driverId: valid.id, status: "accepted" },
      ]);
      const res = await session.call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "logistics" });
      expect(res.status).toBe(200);
      const check = res.body.checks.find((c: any) => c.key === "driver_cpc_valid");
      expect(check.passed).toBe(true);
      expect(check.cpcIneligibleCode).toBeUndefined();
      expect(leakText(res.body)).not.toContain(expired.employeeNumber as string);
    }, 60000);
  }
});
