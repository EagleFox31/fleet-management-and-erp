import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  alerts,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  workOrders,
} from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestPart,
  createTestUser,
  createTestVehicle,
  TEST_USER_PASSWORD,
  type TestUserRole,
} from "../support/factories";

/**
 * « Demander la pièce » depuis un OT : le serveur décide au clic. Stock
 * suffisant : sortie directe au prix du catalogue. Stock insuffisant : le
 * disponible sort, le manquant part en demande, l'OT passe en attente de
 * pièces. Le stock ne devient jamais négatif. Chaque transition émet son
 * événement temps réel. Écrit en base ; tout ce qui est créé est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];

// Trames temps réel : le serveur de contrat n'ouvre pas de WebSocket, on
// capture ce qui serait diffusé.
const broadcasts: Array<{ event: string; payload: any }> = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function login(username: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", {
    body: { username, password: TEST_USER_PASSWORD },
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function seed(role: TestUserRole, stock: number) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: stock, unitPrice: "15000.00" });
  ids.partIds.push(part.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({
      vehicleId: vehicle.id,
      title: "TEST pièces OT",
      status: "in_progress",
      technicianId: role === "technician" ? user.id : null,
    })
    .returning();
  workOrderIds.push(workOrder.id);
  return { user, part, workOrder, cookie: await login(user.username) };
}

async function stateOf(workOrderId: number, partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  const lines = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrderId));
  const requirements = await db
    .select()
    .from(partRequirements)
    .where(eq(partRequirements.workOrderId, workOrderId));
  return { stock: part.quantity, status: workOrder.status, lines, requirements };
}

const eventsOf = (workOrderId: number) =>
  broadcasts.filter((b) => Number(b.payload?.workOrderId) === workOrderId).map((b) => b.event);

beforeAll(async () => {
  (global as any).broadcastUpdate = (event: string, payload: any) => broadcasts.push({ event, payload });
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

beforeEach(() => {
  broadcasts.length = 0;
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  // Lignes, demandes et mouvements d'abord : ils référencent l'OT et la pièce.
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  // Le stock épuisé lève une alerte rattachée à l'utilisateur de test.
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

// Compte, véhicule, pièce, OT, session puis plusieurs appels : nombreux allers-retours Neon.
describe("POST /api/work-orders/:id/parts", { timeout: 120000 }, () => {
  it("stock suffisant : sortie directe au prix du catalogue ; épuisé : demande et OT en attente", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 1);

    // Sans unitPrice, et une tentative de fixer le prix ignorée.
    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1, unitPrice: "1" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ issuedQuantity: 1, missingQuantity: 0, requirement: null });
    expect(eventsOf(workOrder.id)).toEqual(["part_used_added"]);

    let state = await stateOf(workOrder.id, part.id);
    expect(Number(state.lines[0].unitPrice)).toBe(15000);
    expect(state.stock).toBe(0);
    expect(state.status).toBe("in_progress");

    // Stock épuisé : plus de refus, une demande pour le manquant.
    broadcasts.length = 0;
    const second = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ issuedQuantity: 0, missingQuantity: 1, workOrderStatusChanged: true });
    expect(second.body.message).toContain("L'OT est en attente de pièces.");
    expect(eventsOf(workOrder.id)).toEqual([
      "part_requirement_created",
      "work_order_updated",
      "work_order_awaiting_parts",
    ]);
    const updated = broadcasts.find((b) => b.event === "work_order_updated");
    expect(updated?.payload.updates).toEqual({ status: "awaiting_parts" });

    state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(0);
    expect(state.status).toBe("awaiting_parts");
    expect(state.requirements.map((r) => [r.status, r.quantityNeeded])).toEqual([["pending", 1]]);

    // Rejoué : la demande en cours est réutilisée, rien de neuf n'est diffusé.
    broadcasts.length = 0;
    const replay = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.usedExistingRequirement).toBe(true);
    expect(eventsOf(workOrder.id)).toEqual([]);
    expect((await stateOf(workOrder.id, part.id)).requirements).toHaveLength(1);
  });

  it("technicien, stock partiel : le disponible sort, le manquant est demandé", async () => {
    const { user, part, workOrder, cookie } = await seed("technician", 2);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 5 },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ issuedQuantity: 2, missingQuantity: 3 });
    expect(eventsOf(workOrder.id)).toEqual([
      "part_used_added",
      "part_requirement_created",
      "work_order_updated",
      "work_order_awaiting_parts",
    ]);
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(0);
    expect(state.lines.map((l) => l.quantity)).toEqual([2]);
    expect(state.requirements).toHaveLength(1);
    expect(state.requirements[0]).toMatchObject({ quantityNeeded: 3, requestedBy: user.id, status: "pending" });
    expect(state.status).toBe("awaiting_parts");
  });

  it("quantité invalide : 400 lisible, stock intact", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 4);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: "abc" },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Quantité invalide/);
    expect((await stateOf(workOrder.id, part.id)).stock).toBe(4);
  });

  it("le magasin ne demande pas de pièce sur un OT (403) : il sort les demandes reçues", async () => {
    const { part, workOrder, cookie } = await seed("warehouse", 4);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });

    expect(res.status).toBe(403);
    expect((await stateOf(workOrder.id, part.id)).stock).toBe(4);
  });
});

describe("POST /api/work-orders/:id/awaiting-parts", { timeout: 120000 }, () => {
  it("avec une pièce en stock : sortie directe, pas de demande ni d'attente", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 3);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/awaiting-parts`, {
      cookie,
      body: { partId: part.id, quantityNeeded: 2 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issuedQuantity: 2, missingQuantity: 0, statusWasChanged: false });
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(1);
    expect(state.requirements).toHaveLength(0);
    expect(state.status).toBe("in_progress");
  });

  it("sans pièce : l'OT seul passe en attente", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 3);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/awaiting-parts`, { cookie, body: {} });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requirement: null, statusWasChanged: true });
    const state = await stateOf(workOrder.id, part.id);
    expect(state.status).toBe("awaiting_parts");
    expect(state.stock).toBe(3);
  });
});
