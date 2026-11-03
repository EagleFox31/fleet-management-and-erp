import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { assignments, fuelRecords, missions } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { expectWaitsForLock } from "../support/fuel-card-lock";
import { uniqueTestToken } from "../support/ids";

/**
 * Régularisation d'un plein de mission (POST /api/missions/:id/fuel-records/regularize) :
 * elle débite la carte carburant. Un double clic ou un nouvel envoi après une coupure, avec
 * la même clé de requête, rejoue la première écriture au lieu de débiter une seconde fois.
 * Deux régularisations distinctes simultanées gardent leurs deux entrées de journal, et une
 * déclaration « sans ravitaillement » concurrente n'efface pas une régularisation.
 */

const ACTORS = { logistics: "logistics" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

async function deliveredMission() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("REGUL"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "delivered" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, status: "accepted" } as any);
  // Solde suffisant quel que soit l'état de la base de test.
  const { balance } = await fuelCardService.getCurrentBalance();
  await createTestFuelRecord({
    vehicleId: v.id,
    creditAmount: (Math.max(0, -balance) + 10_000).toFixed(2),
    debitAmount: "0",
    cost: "0",
    quantity: 0,
  });
  return { missionId: m.id, vehicleId: v.id };
}

const regularize = (missionId: number, body: Record<string, unknown>) =>
  session.call("POST", `/api/missions/${missionId}/fuel-records/regularize`, { actor: "logistics", body });

const fill = (vehicleId: number, extra: Record<string, unknown> = {}) => ({
  vehicleId,
  quantity: 2,
  unitPrice: 100,
  regularizationReason: "Ticket retrouvé après livraison",
  ...extra,
});

async function missionDebits(missionId: number) {
  return db.select().from(fuelRecords).where(eq(fuelRecords.missionId, missionId));
}

async function regularizationEntries(missionId: number): Promise<Array<Record<string, unknown>>> {
  const [m] = await db.select({ workflowData: missions.workflowData }).from(missions).where(eq(missions.id, missionId));
  const tracking = (m?.workflowData as { fuelTracking?: { regularizations?: unknown } } | null)?.fuelTracking;
  return Array.isArray(tracking?.regularizations) ? (tracking.regularizations as Array<Record<string, unknown>>) : [];
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  }
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("régularisation de plein mission : idempotence", { timeout: 180000 }, () => {
  it("double POST simultané avec la même clé : un seul débit, une seule entrée, même réponse", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("regul-key");
    const balanceBefore = (await fuelCardService.getCurrentBalance()).balance;

    const [a, b] = await Promise.all([
      regularize(missionId, fill(vehicleId, { requestKey })),
      regularize(missionId, fill(vehicleId, { requestKey })),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const replayed = a.status === 200 ? a : b;
    const first = a.status === 201 ? a : b;
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.record.id).toBe(first.body.record.id);
    expect(replayed.body.regularization).toEqual(first.body.regularization);

    expect(await missionDebits(missionId)).toHaveLength(1);
    const entries = await regularizationEntries(missionId);
    expect(entries).toHaveLength(1);
    expect(entries[0].requestKey).toBe(requestKey);
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(balanceBefore - 200, 2);
  });

  it("nouvel envoi séquentiel avec la même clé : rejoué, sans second débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("regul-retry");

    const first = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(first.status).toBe(201);
    const retry = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(retry.status).toBe(200);
    expect(retry.body.record.id).toBe(first.body.record.id);
    expect(retry.body.totals.recordsCount).toBe(1);
    expect(await missionDebits(missionId)).toHaveLength(1);
  });

  it("même clé, autre plein : 409 sans débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("regul-mismatch");

    expect((await regularize(missionId, fill(vehicleId, { requestKey }))).status).toBe(201);
    const res = await regularize(missionId, fill(vehicleId, { requestKey, quantity: 5 }));
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await missionDebits(missionId)).toHaveLength(1);
  });

  it("clé invalide : 400", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const res = await regularize(missionId, fill(vehicleId, { requestKey: "court" }));
    expect(res.status).toBe(400);
    expect(await missionDebits(missionId)).toHaveLength(0);
  });

  it("deux régularisations distinctes simultanées : deux débits, deux entrées de journal", async () => {
    const { missionId, vehicleId } = await deliveredMission();

    const responses = await Promise.all([
      regularize(missionId, fill(vehicleId, { requestKey: uniqueTestToken("regul-a") })),
      regularize(missionId, fill(vehicleId, { quantity: 3 })), // sans clé : client antérieur
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await missionDebits(missionId)).toHaveLength(2);
    const entries = await regularizationEntries(missionId);
    expect(entries.map((e) => e.id).sort()).toEqual(responses.map((r) => r.body.record.id).sort());
  });

  it("déclaration « sans ravitaillement » : contrôle et écriture sous le verrou de la carte", async () => {
    const { missionId } = await deliveredMission();
    const res = await expectWaitsForLock(() =>
      session.call("POST", `/api/missions/${missionId}/fuel-records/declare-no-refuel`, {
        actor: "logistics",
        body: { reason: "Mission sans plein déclarée" },
      }),
    );
    // Le crédit de test est rattaché au véhicule, pas à la mission : aucun plein sur la mission.
    expect(res.status).toBe(200);
  });

  it("déclaration « sans ravitaillement » concurrente : la régularisation n'est jamais effacée", async () => {
    const { missionId, vehicleId } = await deliveredMission();

    const [regul, declare] = await Promise.all([
      regularize(missionId, fill(vehicleId, { requestKey: uniqueTestToken("regul-race") })),
      session.call("POST", `/api/missions/${missionId}/fuel-records/declare-no-refuel`, {
        actor: "logistics",
        body: { reason: "Mission sans plein déclarée" },
      }),
    ]);

    expect(regul.status).toBe(201);
    // Selon l'ordre d'arrivée : déclaration refusée (un plein existe) ou faite puis levée par la régularisation.
    expect([200, 409]).toContain(declare.status);
    const entries = await regularizationEntries(missionId);
    expect(entries.map((e) => e.id)).toEqual([regul.body.record.id]);
  });
});
