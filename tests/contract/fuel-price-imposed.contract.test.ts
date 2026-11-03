import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { getFuelPriceAt } from "../../server/services/fuel-price-service";
import { assignments, fuelRecords, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Prix du litre d'un débit de carte carburant : imposé côté serveur.
 * Seuls admin et logistique fixent le prix (décision du 31 octobre 2026). Pour les autres rôles,
 * l'écran affiche le prix du jour en lecture seule ; le serveur l'impose aussi, sinon un appel
 * direct à l'API débitait la carte au prix choisi par l'appelant.
 * Routes : POST /api/fuel-card/consumption, POST /api/missions/:id/fuel-records et /regularize.
 */
const ACTORS = { logistics: "logistics", secretary: "secretary" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const TODAY = new Date().toISOString().slice(0, 10);
const FORGED_PRICE = 1;
const QUANTITY = 2;

async function fundedVehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const { balance } = await fuelCardService.getCurrentBalance();
  await createTestFuelRecord({
    vehicleId: v.id,
    creditAmount: (Math.max(0, -balance) + 10_000).toFixed(2),
    debitAmount: "0",
    cost: "0",
    quantity: 0,
  });
  return v.id;
}

async function deliveredMission() {
  const vehicleId = await fundedVehicle();
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("PRIX"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "delivered" } as any)
    .returning();
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId, status: "accepted" } as any);
  return { missionId: m.id, vehicleId };
}

async function debitOf(missionId: number) {
  const rows = await db.select().from(fuelRecords).where(eq(fuelRecords.missionId, missionId));
  expect(rows).toHaveLength(1);
  return Number(rows[0].debitAmount);
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("prix du carburant imposé aux rôles qui ne le fixent pas", { timeout: 180000 }, () => {
  const consumption = (vehicleId: number) => ({
    vehicleId,
    quantity: QUANTITY,
    unitPrice: FORGED_PRICE,
    date: TODAY,
    stationName: uniqueTestToken("sta"),
    destination: "Douala",
  });

  it("carte : secrétariat -> prix envoyé ignoré, débit au prix du jour", async () => {
    const official = await getFuelPriceAt(TODAY);
    expect(official).not.toBe(FORGED_PRICE);
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "secretary", body: consumption(await fundedVehicle()) });
    expect(res.status).toBe(201);
    expect(Number(res.body.consumption.debitAmount)).toBeCloseTo(QUANTITY * official, 2);
  });

  it("carte : logistique -> prix saisi retenu", async () => {
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "logistics", body: consumption(await fundedVehicle()) });
    expect(res.status).toBe(201);
    expect(Number(res.body.consumption.debitAmount)).toBeCloseTo(QUANTITY * FORGED_PRICE, 2);
  });

  it("carte : prix absent -> 400 pour tous (contrat inchangé)", async () => {
    const { unitPrice: _omit, ...body } = consumption(await fundedVehicle());
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor: "secretary", body });
    expect(res.status).toBe(400);
  });

  it("carte : logistique avec un prix illisible -> 400 lisible, pas de repli silencieux", async () => {
    const res = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "logistics",
      body: { ...consumption(await fundedVehicle()), unitPrice: "abc" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Prix du litre invalide.");
  });

  it("carte : date illisible -> 400 lisible", async () => {
    const res = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "logistics",
      body: { ...consumption(await fundedVehicle()), date: "pas-une-date" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Date de plein invalide.");
  });

  it("plein de mission : secrétariat -> débit au prix du jour", async () => {
    const official = await getFuelPriceAt(TODAY);
    const { missionId, vehicleId } = await deliveredMission();
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records`, {
      actor: "secretary",
      body: { vehicleId, quantity: QUANTITY, unitPrice: FORGED_PRICE, requestKey: uniqueTestToken("k") },
    });
    expect(res.status).toBe(201);
    expect(await debitOf(missionId)).toBeCloseTo(QUANTITY * official, 2);
  });

  it("régularisation : secrétariat -> débit et entrée de journal au prix du jour", async () => {
    const official = await getFuelPriceAt(TODAY);
    const { missionId, vehicleId } = await deliveredMission();
    const res = await session.call("POST", `/api/missions/${missionId}/fuel-records/regularize`, {
      actor: "secretary",
      body: {
        vehicleId,
        quantity: QUANTITY,
        unitPrice: FORGED_PRICE,
        regularizationReason: "Ticket retrouvé après livraison",
        requestKey: uniqueTestToken("k"),
      },
    });
    expect(res.status).toBe(201);
    expect(await debitOf(missionId)).toBeCloseTo(QUANTITY * official, 2);
    const [m] = await db.select({ workflowData: missions.workflowData }).from(missions).where(eq(missions.id, missionId));
    const entries = (m?.workflowData as any)?.fuelTracking?.regularizations ?? [];
    expect(entries.map((e: { unitPrice: number }) => e.unitPrice)).toEqual([official]);
  });

  it("même clé renvoyée par le secrétariat avec un autre prix forgé : rejeu, pas de 409", async () => {
    const { missionId, vehicleId } = await deliveredMission();
    const requestKey = uniqueTestToken("k");
    const send = (unitPrice: number) =>
      session.call("POST", `/api/missions/${missionId}/fuel-records`, {
        actor: "secretary",
        body: { vehicleId, quantity: QUANTITY, unitPrice, requestKey },
      });
    expect((await send(FORGED_PRICE)).status).toBe(201);
    const again = await send(FORGED_PRICE + 7);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
  });
});
