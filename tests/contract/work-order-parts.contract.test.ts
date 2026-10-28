import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, parts, partsStockMovements, partsUsed, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestPart,
  createTestUser,
  createTestVehicle,
  TEST_USER_PASSWORD,
} from "../support/factories";

/**
 * Ajout d'une pièce à un OT: le prix vient du catalogue. Un corps sans
 * `unitPrice` renvoyait 500 (NOT NULL) et un client pouvait fixer le coût.
 * Écrit en base; tout ce qui est créé est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];

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

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  // Lignes et mouvements d'abord: ils référencent l'OT et la pièce.
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
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

// Compte, véhicule, pièce, OT, session puis deux appels: nombreux allers-retours Neon.
describe("POST /api/work-orders/:id/parts", { timeout: 120000 }, () => {
  it("prend le prix du catalogue et décrémente le stock", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    ids.userIds.push(manager.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart({ quantity: 1, unitPrice: "15000.00" });
    ids.partIds.push(part.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST pièces OT", status: "in_progress" })
      .returning();
    workOrderIds.push(workOrder.id);
    const cookie = await login(manager.username);

    // Sans unitPrice, et une tentative de fixer le prix ignorée.
    const res = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1, unitPrice: "1" },
    });
    expect(res.status).toBe(201);

    const [line] = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrder.id));
    expect(Number(line.unitPrice)).toBe(15000);
    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(0);

    const second = await call("POST", `/api/work-orders/${workOrder.id}/parts`, {
      cookie,
      body: { partId: part.id, quantity: 1 },
    });
    expect(second.status).toBe(400);
  });
});
