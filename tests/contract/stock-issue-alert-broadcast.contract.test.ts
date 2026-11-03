import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { alerts, partRequirements, partsStockMovements, partsUsed, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Sortie de stock (POST /api/work-orders/:id/part-requirements/:id/issue) qui fait passer la
 * pièce sous son minimum : l'alerte de stock bas est écrite dans la transaction de la sortie
 * et sa trame `alert_created` part après le commit. Écrit en base ; tout est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const spy = vi.fn();
const previousBroadcast = (global as any).broadcastUpdate;

beforeAll(async () => {
  (global as any).broadcastUpdate = spy;
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.link, ids.partIds.map((id) => `/warehouse/parts/${id}`)));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("sortie de stock sous le minimum : trame alert_created", { timeout: 120000 }, () => {
  it("le magasinier sort 2 pièces sur 6 (minimum 5) : alerte en base et trame diffusée", async () => {
    const warehouse = await createTestUser({ role: "warehouse" });
    ids.userIds.push(warehouse.id);
    const login = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: warehouse.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart({ quantity: 6, minQuantity: 5, unitPrice: "5000.00" });
    ids.partIds.push(part.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST alerte de stock", status: "in_progress" })
      .returning();
    workOrderIds.push(workOrder.id);
    const [requirement] = await db
      .insert(partRequirements)
      .values({
        partId: part.id,
        workOrderId: workOrder.id,
        vehicleId: vehicle.id,
        quantityNeeded: 2,
        urgency: "high",
        reason: "TEST alerte de stock",
        status: "received",
        requestedBy: warehouse.id,
      })
      .returning();
    spy.mockClear();

    const res = await fetch(baseUrl + `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);

    const stored = await db.select().from(alerts).where(eq(alerts.link, `/warehouse/parts/${part.id}`));
    expect(stored).toHaveLength(1);
    const frames = spy.mock.calls.filter(([event]) => event === "alert_created").map(([, frame]) => frame);
    expect(frames.map((frame) => frame.entityId)).toEqual([stored[0].id]);
    expect(frames[0].scope).toEqual({ type: "user", userIds: [stored[0].userId] });
  });
});
