import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, missions } from "../../shared/schema";
import { apiErrorProblems, leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Erreurs des pleins de mission (AGENTS §10) : un solde insuffisant répond une phrase lisible,
 * sans le solde de la carte ni le montant calculé (le message du service les contenait :
 * « Solde insuffisant (14100000 FCFA < … FCFA) »). Statut 409, comme /api/fuel-cards
 * (toFuelCardAppError) : la requête est valide, c'est l'état de la carte qui la refuse.
 */

const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

async function missionWithVehicle(status: string) {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("FERR"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, status: "accepted" } as any);
  return { missionId: m.id, vehicleId: v.id };
}

/** Coût hors de portée de toute carte : 1e6 L à 1e6 FCFA. */
const hugeFill = (vehicleId: number) => ({
  vehicleId,
  quantity: 1_000_000,
  unitPrice: 1_000_000,
  requestKey: uniqueTestToken("ferr-key"),
});

function expectReadableBalanceError(res: { status: number; body: any; headers: Headers }) {
  expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
  expect(res.body.message).toBe("Solde de la carte carburant insuffisant.");
  expect(leakText(res.body)).not.toMatch(/FCFA|\d{6,}/);
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("pleins de mission : erreur de solde lisible", { timeout: 180000 }, () => {
  it("POST /:id/fuel-records : solde insuffisant -> 409 sans montant", async () => {
    const { missionId, vehicleId } = await missionWithVehicle("in_progress");
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "logistics", body: hugeFill(vehicleId) });
    expectReadableBalanceError(res);
  });

  it("POST /:id/fuel-records/regularize : solde insuffisant -> 409 sans montant", async () => {
    const { missionId, vehicleId } = await missionWithVehicle("delivered");
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records/regularize`, {
      actor: "logistics",
      body: { ...hugeFill(vehicleId), regularizationReason: "Ticket retrouvé après livraison" },
    });
    expectReadableBalanceError(res);
  });
});
