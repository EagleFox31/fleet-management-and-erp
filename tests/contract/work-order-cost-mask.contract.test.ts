import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, partsUsed, tireRotations, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Coûts d'OT (`cost`, `unitPrice`, `totalCost`, `estimatedCost`, `partUnitPrice`) dans les lectures
 * `GET /api/work-orders/*` : visibles des rôles coût, retirés (200, pas 403) pour le chauffeur et le
 * client. L'assertion porte sur le corps entier : ni la clé ni la valeur sentinelle.
 *
 * Garde-fou de couverture : `tests/unit/server/work-order-cost-mask-coverage.test.ts` exige que tout GET
 * monté sous /work-orders figure ici (ROUTES) ou dans sa liste d'exemptions justifiée.
 */

const WORK_ORDER_COST = "7777.77";
const PART_UNIT_PRICE = "4321.37";
const REQUIREMENT_ESTIMATE = "5555.55";
const ROTATION_COST = "3333.33";
const ALL_SENTINELS = [WORK_ORDER_COST, PART_UNIT_PRICE, REQUIREMENT_ESTIMATE, ROTATION_COST];
const COST_KEYS = ['"cost"', '"unitPrice"', '"totalCost"', '"estimatedCost"', '"partUnitPrice"'];

type Actor = "manager" | "technician" | "driver" | "client";
const ids = createIdBag();
const workOrderIds: number[] = [];
let api: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let workOrderId = 0;
let vehicleId = 0;
const title = `TEST masque coût ${uniqueTestToken("wo")}`;

/** `covers` : route Express couverte (lue par le garde-fou de couverture) ; `sentinels` : valeurs que le rôle coût doit voir ; `marker` : preuve que la réponse reste utile au chauffeur. */
type Route = { name: string; covers: string; path: () => string; clientAllowed: boolean; sentinels: string[]; marker: () => string };
const ROUTES: Route[] = [
  { name: "liste", covers: "/api/work-orders", path: () => `/api/work-orders?search=${encodeURIComponent(title)}`, clientAllowed: true, sentinels: [WORK_ORDER_COST], marker: () => String(workOrderId) },
  { name: "détail", covers: "/api/work-orders/:id", path: () => `/api/work-orders/${workOrderId}`, clientAllowed: true, sentinels: [WORK_ORDER_COST], marker: () => String(workOrderId) },
  { name: "pièces posées", covers: "/api/work-orders/:workOrderId/parts", path: () => `/api/work-orders/${workOrderId}/parts`, clientAllowed: true, sentinels: [PART_UNIT_PRICE], marker: () => '"partId"' },
  { name: "historique du véhicule", covers: "/api/work-orders/vehicle/:vehicleId", path: () => `/api/work-orders/vehicle/${vehicleId}`, clientAllowed: true, sentinels: [WORK_ORDER_COST], marker: () => String(workOrderId) },
  { name: "en attente de pièces", covers: "/api/work-orders/awaiting-parts", path: () => "/api/work-orders/awaiting-parts", clientAllowed: false, sentinels: [WORK_ORDER_COST], marker: () => String(workOrderId) },
  {
    name: "demandes de pièce en attente", covers: "/api/work-orders/:workOrderId/pending-part-requirements",
    path: () => `/api/work-orders/${workOrderId}/pending-part-requirements`,
    clientAllowed: true,
    sentinels: [REQUIREMENT_ESTIMATE, PART_UNIT_PRICE],
    marker: () => '"partName"',
  },
  { name: "rotations de pneus", covers: "/api/work-orders/:workOrderId/tire-rotations", path: () => `/api/work-orders/${workOrderId}/tire-rotations`, clientAllowed: true, sentinels: [ROTATION_COST], marker: () => '"rotationType"' },
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
  await db.insert(partRequirements).values({
    workOrderId: workOrder.id,
    vehicleId: vehicle.id,
    partId: part.id,
    quantityNeeded: 1,
    reason: "TEST masque coût",
    status: "pending",
    estimatedCost: REQUIREMENT_ESTIMATE,
  });
  await db.insert(tireRotations).values({
    vehicleId: vehicle.id,
    workOrderId: workOrder.id,
    rotationDate: "2026-11-05",
    rotationMileage: 1000,
    rotationType: "front_to_back",
    cost: ROTATION_COST,
  });
});

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await api.close();
});

describe.each(ROUTES)("GET $name : coûts d'OT", (route) => {
  it.each(["manager", "technician"] as const)("%s (rôle coût) voit chaque montant", async (actor) => {
    const res = await api.call("GET", route.path(), { actor });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const sentinel of route.sentinels) expect(text).toContain(sentinel);
  });

  it("le chauffeur reçoit 200 sans clé de coût ni montant", async () => {
    const res = await api.call("GET", route.path(), { actor: "driver" });
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const sentinel of ALL_SENTINELS) expect(text).not.toContain(sentinel);
    for (const key of COST_KEYS) expect(text).not.toContain(key);
    // la réponse reste utile : l'OT ou la ligne est bien là
    expect(text).toContain(route.marker());
  });

  it("le client : 200 sans clé de coût ni montant, ou refus si la route est réservée au personnel", async () => {
    const res = await api.call("GET", route.path(), { actor: "client" });
    if (!route.clientAllowed) {
      expect(res.status).toBe(403);
      return;
    }
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const sentinel of ALL_SENTINELS) expect(text).not.toContain(sentinel);
    for (const key of COST_KEYS) expect(text).not.toContain(key);
  });
});

describe("HEAD", () => {
  it("le Content-Length du chauffeur correspond au corps masqué, pas au corps complet", async () => {
    const path = `/api/work-orders/${workOrderId}`;
    const driverGet = await api.call("GET", path, { actor: "driver" });
    const managerGet = await api.call("GET", path, { actor: "manager" });
    const driverHead = await api.call("HEAD", path, { actor: "driver" });
    const managerHead = await api.call("HEAD", path, { actor: "manager" });
    expect(driverHead.status).toBe(200);
    const maskedLength = Buffer.byteLength(JSON.stringify(driverGet.body));
    const fullLength = Buffer.byteLength(JSON.stringify(managerGet.body));
    expect(maskedLength).toBeLessThan(fullLength);
    expect(Number(driverHead.headers.get("content-length"))).toBe(maskedLength);
    expect(Number(managerHead.headers.get("content-length"))).toBe(fullLength);
  });
});

describe("sans session", () => {
  it("GET /api/work-orders/:id : 401", async () => {
    const res = await api.call("GET", `/api/work-orders/${workOrderId}`);
    expect(res.status).toBe(401);
  });
});
