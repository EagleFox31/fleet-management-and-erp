import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
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
  it("pièce en rayon : rien ne sort, une demande « à sortir » attend le magasinier ; rayon réservé : demande normale", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 1);

    // Une tentative de fixer le prix est ignorée.
    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1, unitPrice: "1" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      issuedQuantity: 0,
      toIssueQuantity: 1,
      missingQuantity: 0,
      partUsed: null,
      requirement: null,
      workOrderStatusChanged: false,
    });
    expect(res.body.stockRequirement).toMatchObject({ status: "received", quantityNeeded: 1 });
    expect(res.body.message).toContain("magasinier");
    expect(eventsOf(workOrder.id)).toEqual(["part_requirement_created"]);

    let state = await stateOf(workOrder.id, part.id);
    expect(state.lines).toHaveLength(0);
    expect(state.stock).toBe(1);
    expect(state.status).toBe("in_progress");
    expect(state.requirements.map((r) => [r.status, r.quantityNeeded])).toEqual([["received", 1]]);
    expect(Number(state.requirements[0].estimatedCost)).toBe(15000);

    // Rejoué : la demande en cours est réutilisée, rien de neuf n'est diffusé.
    broadcasts.length = 0;
    const replay = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.usedExistingRequirement).toBe(true);
    expect(eventsOf(workOrder.id)).toEqual([]);
    state = await stateOf(workOrder.id, part.id);
    expect(state.requirements).toHaveLength(1);
    expect(state.stock).toBe(1);

    // Un autre OT : l'unité en rayon est réservée à la première demande.
    const [otherWorkOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: workOrder.vehicleId, title: "TEST pièces OT 2", status: "in_progress" })
      .returning();
    workOrderIds.push(otherWorkOrder.id);
    broadcasts.length = 0;
    const second = await call("POST", `/api/work-orders/${otherWorkOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ toIssueQuantity: 0, missingQuantity: 1, workOrderStatusChanged: true });
    expect(second.body.message).toContain("L'OT est en attente de pièces.");
    expect(eventsOf(otherWorkOrder.id)).toEqual([
      "part_requirement_created",
      "work_order_updated",
      "work_order_awaiting_parts",
    ]);
    const updated = broadcasts.find((b) => b.event === "work_order_updated");
    expect(updated?.payload.updates).toEqual({ status: "awaiting_parts" });
    const otherState = await stateOf(otherWorkOrder.id, part.id);
    expect(otherState.status).toBe("awaiting_parts");
    expect(otherState.requirements.map((r) => [r.status, r.quantityNeeded])).toEqual([["pending", 1]]);
    expect(otherState.stock).toBe(1);
  });

  it("technicien, stock partiel : le disponible attend le magasinier, le manquant est demandé", async () => {
    const { user, part, workOrder, cookie } = await seed("technician", 2);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 5 },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ issuedQuantity: 0, toIssueQuantity: 2, missingQuantity: 3, partUsed: null });
    expect(eventsOf(workOrder.id)).toEqual([
      "part_requirement_created",
      "part_requirement_created",
      "work_order_updated",
      "work_order_awaiting_parts",
    ]);
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(2);
    expect(state.lines).toHaveLength(0);
    const byStatus = Object.fromEntries(state.requirements.map((r) => [r.status, r]));
    expect(state.requirements).toHaveLength(2);
    expect(byStatus.received).toMatchObject({ quantityNeeded: 2, requestedBy: user.id });
    expect(byStatus.pending).toMatchObject({ quantityNeeded: 3, requestedBy: user.id });
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
  it("avec une pièce en stock : rien ne sort, une demande « à sortir » pour le magasinier", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 3);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/awaiting-parts`, {
      cookie,
      body: { partId: part.id, quantityNeeded: 2 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issuedQuantity: 0, toIssueQuantity: 2, missingQuantity: 0, statusWasChanged: false });
    const state = await stateOf(workOrder.id, part.id);
    expect(state.stock).toBe(3);
    expect(state.lines).toHaveLength(0);
    expect(state.requirements.map((r) => [r.status, r.quantityNeeded])).toEqual([["received", 2]]);
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

  // La route lit l'OT puis écrit : un chef d'atelier qui l'annule entre les deux ne doit pas
  // être écrasé. Déterministe : une connexion tient le verrou de ligne de l'OT, la requête s'y
  // bloque après sa lecture, l'OT est annulé, puis le verrou est libéré.
  it("OT annulé pendant la demande : 409 lisible, l'annulation est conservée", async () => {
    const { part, workOrder, cookie } = await seed("workshop_manager", 3);
    const client = await pool.connect();
    let res: Awaited<ReturnType<typeof call>>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM work_orders WHERE id = $1 FOR UPDATE", [workOrder.id]);
      const holderPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const pending = call("POST", `/api/work-orders/${workOrder.id}/awaiting-parts`, { cookie, body: {} });
      await waitForBlockedWriter(holderPid);
      await client.query("UPDATE work_orders SET status = 'cancelled' WHERE id = $1", [workOrder.id]);
      await client.query("COMMIT");
      res = await pending;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("vient de changer");
    expect((await stateOf(workOrder.id, part.id)).status).toBe("cancelled");
    expect(eventsOf(workOrder.id)).not.toContain("work_order_updated");
  });
});

/** Attend qu'une requête soit bloquée PAR la connexion qui tient le verrou. */
async function waitForBlockedWriter(holderPid: number) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("la requête ne s'est jamais bloquée sur le verrou de l'OT");
}
