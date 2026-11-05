import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partsUsed, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Coûts d'OT (`cost`, `unitPrice`, `totalCost`) dans les lectures `GET /api/work-orders/*` : visibles
 * des rôles coût, retirés (200, pas 403) pour le chauffeur et le client. L'assertion porte sur le
 * corps entier : ni la clé ni la valeur sentinelle.
 */

const WORK_ORDER_COST = "7777.77";
const PART_UNIT_PRICE = "4321.37";
const COST_KEYS = ['"cost"', '"unitPrice"', '"totalCost"'];

type Actor = "manager" | "technician" | "driver" | "client";
const ids = createIdBag();
const workOrderIds: number[] = [];
let api: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let workOrderId = 0;
let vehicleId = 0;
const title = `TEST masque coût ${uniqueTestToken("wo")}`;

type Route = { name: string; path: () => string; clientAllowed: boolean; hasPartPrice: boolean };
const ROUTES: Route[] = [
  { name: "liste", path: () => `/api/work-orders?search=${encodeURIComponent(title)}`, clientAllowed: true, hasPartPrice: false },
  { name: "détail", path: () => `/api/work-orders/${workOrderId}`, clientAllowed: true, hasPartPrice: false },
  { name: "pièces posées", path: () => `/api/work-orders/${workOrderId}/parts`, clientAllowed: true, hasPartPrice: true },
  { name: "historique du véhicule", path: () => `/api/work-orders/vehicle/${vehicleId}`, clientAllowed: true, hasPartPrice: false },
  { name: "en attente de pièces", path: () => "/api/work-orders/awaiting-parts", clientAllowed: false, hasPartPrice: false },
];

beforeAll(async () => {
  api = await startContractActors<Actor>(
    { manager: "workshop_manager", technician: "technician", driver: "driver", client: "client" },
    ids.userIds,
  );
  const vehicle = await createTestVehicle({ ownerId: api.userIdOf("client") });
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const part = await createTestPart({ quantity: 5, unitPrice: PART_UNIT_PRICE });
  ids.partIds.push(part.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title, status: "awaiting_parts", cost: WORK_ORDER_COST })
    .returning();
  workOrderId = workOrder.id;
  workOrderIds.push(workOrder.id);
  await db.insert(partsUsed).values({ workOrderId: workOrder.id, partId: part.id, quantity: 1, unitPrice: PART_UNIT_PRICE });
});

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await api.close();
});

describe.each(ROUTES)("GET $name : coûts d'OT", (route) => {
  const sentinel = route.hasPartPrice ? PART_UNIT_PRICE : WORK_ORDER_COST;

  it.each(["manager", "technician"] as const)("%s (rôle coût) voit le montant", async (actor) => {
    const res = await api.call("GET", route.path(), { actor });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(sentinel);
  });

  it("le chauffeur reçoit 200 sans clé de coût ni montant", async () => {
    const res = await api.call("GET", route.path(), { actor: "driver" });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(WORK_ORDER_COST);
    expect(text).not.toContain(PART_UNIT_PRICE);
    for (const key of COST_KEYS) expect(text).not.toContain(key);
    // la réponse reste utile : l'OT ou la ligne est bien là
    expect(text).toContain(route.hasPartPrice ? '"partId"' : String(workOrderId));
  });

  it("le client : 200 sans clé de coût ni montant, ou refus si la route est réservée au personnel", async () => {
    const res = await api.call("GET", route.path(), { actor: "client" });
    if (!route.clientAllowed) {
      expect(res.status).toBe(403);
      return;
    }
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(WORK_ORDER_COST);
    expect(text).not.toContain(PART_UNIT_PRICE);
    for (const key of COST_KEYS) expect(text).not.toContain(key);
  });
});

describe("sans session", () => {
  it("GET /api/work-orders/:id : 401", async () => {
    const res = await api.call("GET", `/api/work-orders/${workOrderId}`);
    expect(res.status).toBe(401);
  });
});
