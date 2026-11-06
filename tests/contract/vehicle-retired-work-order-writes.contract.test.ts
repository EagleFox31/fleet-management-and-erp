import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, parts, partsStockMovements, partsUsed, vehicles, workOrders } from "../../shared/schema";
import { VEHICLE_RETIRED_EDIT_MESSAGE } from "../../server/lib/vehicle-retired";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestVehicle } from "../support/factories";

/**
 * L3b : une écriture qui n'atteint le véhicule que par un OT (`workOrderId` dans le chemin ou le corps)
 * est refusée en 409 quand le véhicule de l'OT est retiré, sans ligne créée ni stock modifié.
 * Routes représentatives : demande de pièce sur OT (chemin) et mouvement de stock imputé à un OT (corps).
 * Témoins : mêmes écritures acceptées sur un OT de véhicule actif ; mouvement magasin sans OT accepté.
 */
const ids = createIdBag();
let actors: Awaited<ReturnType<typeof startContractActors<"admin">>>;
const R = { vehicle: 0, wo: 0 };
const A = { vehicle: 0, wo: 0 };
let partId = 0;

/** Empreinte d'une écriture d'OT : demandes, pièces posées, mouvements et quantité de la pièce. */
async function footprint(workOrderId: number) {
  const n = async (table: any, column: any, value: number) => Number((await db.select({ n: count() }).from(table).where(eq(column, value)))[0].n);
  const [part] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return {
    requirements: await n(partRequirements, partRequirements.workOrderId, workOrderId),
    partsUsed: await n(partsUsed, partsUsed.workOrderId, workOrderId),
    movements: await n(partsStockMovements, partsStockMovements.partId, partId),
    quantity: part.quantity,
  };
}

beforeAll(async () => {
  actors = await startContractActors({ admin: "admin" }, ids.userIds);
  const retired = await createTestVehicle();
  const active = await createTestVehicle();
  ids.vehicleIds.push(retired.id, active.id);
  const part = await createTestPart({ quantity: 20 } as any);
  ids.partIds.push(part.id);
  partId = part.id;
  for (const [target, vehicleId] of [[R, retired.id], [A, active.id]] as const) {
    const [wo] = await db.insert(workOrders).values({ vehicleId, title: "TEST OT L3b", status: "in_progress", priority: "medium" } as any).returning();
    Object.assign(target, { vehicle: vehicleId, wo: wo.id });
  }
  await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, retired.id));
}, 180000);

afterAll(async () => {
  try {
    const woIds = [R.wo, A.wo].filter(Boolean);
    if (woIds.length) {
      await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, woIds));
      await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, woIds));
      await db.delete(workOrders).where(inArray(workOrders.id, woIds));
    }
    await cleanupCreated(ids);
  } finally {
    await actors?.close();
  }
}, 60000);

type Write = [label: string, method: string, url: (wo: number) => string, body: (wo: number) => unknown];

const WRITES: Write[] = [
  ["demande de pièce sur OT", "POST", (wo) => `/api/work-orders/${wo}/parts`, () => ({ partId, quantity: 1, reason: "TEST L3b" })],
  ["demande de pièce, barre finale", "POST", (wo) => `/api/work-orders/${wo}/parts/`, () => ({ partId, quantity: 1, reason: "TEST L3b" })],
  ["mouvement de stock imputé à l'OT", "POST", () => "/api/warehouse/stock-movement", (wo) => ({ partId, type: "in", quantity: 1, reason: "TEST L3b", workOrderId: wo })],
  ["mouvement de stock, casse du chemin", "POST", () => "/api/Warehouse/Stock-Movement", (wo) => ({ partId, type: "out", quantity: 1, reason: "TEST L3b", workOrderId: String(wo) })],
];

describe("L3b : OT d'un véhicule retiré", () => {
  it.each(WRITES)("%s : 409, aucune écriture", async (_label, method, url, body) => {
    const before = await footprint(R.wo);
    const res = await actors.call(method, url(R.wo), { actor: "admin", body: body(R.wo) });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toBe(VEHICLE_RETIRED_EDIT_MESSAGE);
    expect(await footprint(R.wo)).toEqual(before);
  });
});

describe("L3b : témoins", () => {
  it("demande de pièce sur un OT de véhicule actif : acceptée", async () => {
    const res = await actors.call("POST", `/api/work-orders/${A.wo}/parts`, { actor: "admin", body: { partId, quantity: 1, reason: "TEST L3b" } });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect((await footprint(A.wo)).requirements).toBeGreaterThan(0);
  });

  it("mouvement de stock imputé à un OT de véhicule actif : accepté", async () => {
    const before = await footprint(A.wo);
    const res = await actors.call("POST", "/api/warehouse/stock-movement", { actor: "admin", body: { partId, type: "in", quantity: 1, reason: "TEST L3b", workOrderId: A.wo } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await footprint(A.wo)).quantity).toBe(before.quantity + 1);
  });

  it("mouvement magasin sans OT : la garde laisse passer", async () => {
    const before = await footprint(R.wo);
    const res = await actors.call("POST", "/api/warehouse/stock-movement", { actor: "admin", body: { partId, type: "in", quantity: 1, reason: "TEST L3b" } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await footprint(R.wo)).movements).toBe(before.movements + 1);
  });
});
