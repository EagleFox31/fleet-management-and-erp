import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { assignments, fuelRecords, missions } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag, deleteTreasuryEntriesOfMissions } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import type { DbExecutor } from "../../server/lib/fuel-card-lock";
import { expectWaitsForLock, expectWaitsForMissionRowLock } from "../support/fuel-card-lock";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * Régularisation d'un plein de mission (POST /api/missions/:id/fuel-records/regularize) :
 * elle débite la carte carburant. Un double clic ou un nouvel envoi après une coupure, avec
 * la même clé de requête, rejoue la première écriture au lieu de débiter une seconde fois.
 * Deux régularisations distinctes simultanées gardent leurs deux entrées de journal, et une
 * déclaration « sans ravitaillement » concurrente n'efface pas une régularisation.
 * Le plein normal (POST /api/missions/:id/fuel-records) suit la même règle, et la clé est
 * obligatoire sur les deux routes. La transition de statut et le PATCH budget relisent
 * workflowData sous verrou de ligne : ils n'effacent plus une régularisation validée entre-temps.
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

const recordFuel = (missionId: number, body: Record<string, unknown>) =>
  session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "logistics", body });

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
    await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  }
  if (missionIds.length > 0) {
    await deleteTreasuryEntriesOfMissions(missionIds);
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

  it("sans clé (client antérieur) : 400 qui demande de recharger, aucun débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const res = await regularize(missionId, fill(vehicleId));
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toMatch(/rechargez la page/i);
    expect(await missionDebits(missionId)).toHaveLength(0);
  });

  it.each([
    ["date", { date: "2026-10-02" }],
    ["station", { stationName: "STATION B" }],
    ["motif", { regularizationReason: "Autre motif de régularisation" }],
  ])("même clé, %s différent : 409 sans second débit", async (_label, change) => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("regul-field");
    const base = fill(vehicleId, { requestKey, date: "2026-10-01", stationName: "STATION A" });

    expect((await regularize(missionId, base)).status).toBe(201);
    expect((await regularize(missionId, base)).status).toBe(200);
    const res = await regularize(missionId, { ...base, ...change });
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await missionDebits(missionId)).toHaveLength(1);
  });

  it("régularisation antérieure à la colonne (clé dans le journal seul) : rejouée, sans second débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("regul-legacy");
    const first = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(first.status).toBe(201);
    await db.update(fuelRecords).set({ requestKey: null }).where(eq(fuelRecords.id, first.body.record.id));

    const retry = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(retry.status).toBe(200);
    expect(retry.body.record.id).toBe(first.body.record.id);
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
      regularize(missionId, fill(vehicleId, { requestKey: uniqueTestToken("regul-b"), quantity: 3 })),
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

describe("plein normal de mission : même mécanisme de clé", { timeout: 180000 }, () => {
  const normal = (vehicleId: number, extra: Record<string, unknown> = {}) => ({ vehicleId, quantity: 2, unitPrice: 100, ...extra });

  it("double POST simultané avec la même clé : un seul débit, le second rejoué", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("fill-key");
    const balanceBefore = (await fuelCardService.getCurrentBalance()).balance;

    const [a, b] = await Promise.all([
      recordFuel(missionId, normal(vehicleId, { requestKey })),
      recordFuel(missionId, normal(vehicleId, { requestKey })),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const replayed = a.status === 200 ? a : b;
    const first = a.status === 201 ? a : b;
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.record.id).toBe(first.body.record.id);
    expect(await missionDebits(missionId)).toHaveLength(1);
    expect((await fuelCardService.getCurrentBalance()).balance).toBeCloseTo(balanceBefore - 200, 2);
  });

  it("sans clé : 400 qui demande de recharger, aucun débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const res = await recordFuel(missionId, normal(vehicleId));
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toMatch(/rechargez la page/i);
    expect(await missionDebits(missionId)).toHaveLength(0);
  });

  it("même clé, autre station : 409 ; clé déjà prise par une autre mission : 409", async () => {
    const one = await deliveredMission();
    const two = await deliveredMission();
    const requestKey = uniqueTestToken("fill-mismatch");

    expect((await recordFuel(one.missionId, normal(one.vehicleId, { requestKey, stationName: "STATION A" }))).status).toBe(201);
    const otherStation = await recordFuel(one.missionId, normal(one.vehicleId, { requestKey, stationName: "STATION B" }));
    expect(apiErrorProblems(otherStation.status, otherStation.body, 409, undefined, otherStation.headers.get("x-request-id"))).toEqual([]);
    const otherMission = await recordFuel(two.missionId, normal(two.vehicleId, { requestKey, stationName: "STATION A" }));
    expect(otherMission.status).toBe(409);
    expect(await missionDebits(one.missionId)).toHaveLength(1);
    expect(await missionDebits(two.missionId)).toHaveLength(0);
  });
});

describe("workflowData : statut et budget n'effacent plus une régularisation", { timeout: 180000 }, () => {
  // Simule une régularisation validée pendant que l'écriture attend le verrou de ligne : l'entrée
  // doit survivre, sinon le rejeu de sa clé ne la retrouverait plus et débiterait une seconde fois.
  const commitConcurrentEntry = (missionId: number, requestKey: string) => async (tx: DbExecutor) => {
    const [m] = await tx.select({ workflowData: missions.workflowData }).from(missions).where(eq(missions.id, missionId));
    const wd = (m?.workflowData as Record<string, unknown> | null) ?? {};
    await tx
      .update(missions)
      .set({ workflowData: { ...wd, fuelTracking: { regularizations: [{ id: -1, requestKey }] } } })
      .where(eq(missions.id, missionId));
  };

  const setStatus = (missionId: number, status: string) =>
    session.call("PUT", `/api/missions/${missionId}/status`, { actor: "logistics", body: { status, actualFdrCost: 0 } });

  it("transition delivered -> completed : attend le verrou de ligne et garde l'entrée validée entre-temps", async () => {
    const { missionId } = await deliveredMission();
    const requestKey = uniqueTestToken("race-status");

    const res = await expectWaitsForMissionRowLock(
      missionId,
      () => setStatus(missionId, "completed"),
      commitConcurrentEntry(missionId, requestKey),
    );

    expect(res.status).toBe(200);
    const [m] = await db
      .select({ status: missions.status, workflowData: missions.workflowData })
      .from(missions)
      .where(eq(missions.id, missionId));
    expect(m.status).toBe("completed");
    expect((await regularizationEntries(missionId)).map((e) => e.requestKey)).toEqual([requestKey]);
    // Le patch de la transition est appliqué à la version relue, pas perdu.
    expect((m.workflowData as { execution?: { actualDeliveryDate?: string } }).execution?.actualDeliveryDate).toBeTruthy();
  });

  it("PATCH budget : attend le verrou de ligne et garde l'entrée validée entre-temps", async () => {
    const { missionId } = await deliveredMission();
    const requestKey = uniqueTestToken("race-budget");

    const res = await expectWaitsForMissionRowLock(
      missionId,
      () => session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { budget: { fuelBudget: 50000 } } }),
      commitConcurrentEntry(missionId, requestKey),
    );

    expect(res.status).toBe(200);
    expect((await regularizationEntries(missionId)).map((e) => e.requestKey)).toEqual([requestKey]);
    const [m] = await db.select({ workflowData: missions.workflowData }).from(missions).where(eq(missions.id, missionId));
    expect((m.workflowData as { budgetPlan?: { fuelBudget?: number } }).budgetPlan?.fuelBudget).toBe(50000);
  });

  it("régularisation, clôture, puis rejeu de la même clé : aucun second débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("replay-after-close");

    const first = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(first.status).toBe(201);
    expect((await setStatus(missionId, "completed")).status).toBe(200);

    const retry = await regularize(missionId, fill(vehicleId, { requestKey }));
    expect(retry.status).toBe(200);
    expect(retry.body.record.id).toBe(first.body.record.id);
    expect(await missionDebits(missionId)).toHaveLength(1);
    expect(await regularizationEntries(missionId)).toHaveLength(1);
  });
});

describe("plein normal de mission : statut relu sous le verrou de ligne", { timeout: 180000 }, () => {
  const setStatus = (missionId: number, status: string) =>
    session.call("PUT", `/api/missions/${missionId}/status`, { actor: "logistics", body: { status, actualFdrCost: 0 } });
  const normalFill = (vehicleId: number, requestKey: string) => ({ vehicleId, quantity: 2, unitPrice: 100, requestKey });

  it("plein, clôture, puis rejeu de la même clé : le plein enregistré est renvoyé, sans second débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("normal-replay-closed");

    const first = await recordFuel(missionId, normalFill(vehicleId, requestKey));
    expect(first.status).toBe(201);
    expect((await setStatus(missionId, "completed")).status).toBe(200);

    const retry = await recordFuel(missionId, normalFill(vehicleId, requestKey));
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.record.id).toBe(first.body.record.id);
    expect(await missionDebits(missionId)).toHaveLength(1);
  });

  it("nouveau plein sur une mission clôturée : 400 lisible, aucun débit", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    expect((await setStatus(missionId, "completed")).status).toBe(200);

    const res = await recordFuel(missionId, normalFill(vehicleId, uniqueTestToken("normal-closed")));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Enregistrement carburant impossible pour une mission completed.");
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await missionDebits(missionId)).toHaveLength(0);
  });

  it("clôture concurrente : le plein attend le verrou de ligne, voit la mission clôturée et ne débite pas", async () => {
    const { missionId, vehicleId } = await deliveredMission();

    const res = await expectWaitsForMissionRowLock(
      missionId,
      () => recordFuel(missionId, normalFill(vehicleId, uniqueTestToken("normal-race-close"))),
      async (tx: DbExecutor) => {
        await tx.update(missions).set({ status: "completed" } as any).where(eq(missions.id, missionId));
      },
    );

    expect(res.status).toBe(400);
    expect(await missionDebits(missionId)).toHaveLength(0);
  });
});

