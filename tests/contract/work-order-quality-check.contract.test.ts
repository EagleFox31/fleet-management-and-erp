import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { qualityCheckResponseSchema } from "../../shared/contracts/quality-check";
import { db } from "../../server/db";
import { workOrderQuality, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** T-47 : POST /api/work-orders/:id/quality-check (drapeau `quality-check`). */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();
const workOrderIds: number[] = [];
const previousFlags = process.env.FEATURE_FLAGS;

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
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

async function newWorkOrder(status: "pending" | "in_progress" | "completed") {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId: ids.vehicleIds[0], title: "OT contrôle qualité", status })
    .returning();
  workOrderIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "quality-check=on";
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  for (const role of ["workshop_manager", "technician"] as TestUserRole[]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/work-orders/:id/quality-check", () => {
  it("refuse le technicien (403)", async () => {
    const id = await newWorkOrder("completed");
    const res = await call("POST", `/api/work-orders/${id}/quality-check`, { cookie: cookies.get("technician"), body: { result: "passed" } });
    expect(res.status).toBe(403);
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("refuse sans session (401)", async () => {
    const res = await call("POST", "/api/work-orders/1/quality-check", { body: { result: "passed" } });
    expect(res.status).toBe(401);
  });

  it("répond 409 sur un OT non terminé", async () => {
    const id = await newWorkOrder("in_progress");
    const res = await call("POST", `/api/work-orders/${id}/quality-check`, { cookie: cookies.get("workshop_manager"), body: { result: "passed" } });
    expect(res.status).toBe(409);
  });

  it("répond 400 sur un rejet sans motif", async () => {
    const id = await newWorkOrder("completed");
    const res = await call("POST", `/api/work-orders/${id}/quality-check`, { cookie: cookies.get("workshop_manager"), body: { result: "failed" } });
    expect(res.status).toBe(400);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(row.status).toBe("completed");
  });

  it("répond 404 pour un OT inconnu", async () => {
    const res = await call("POST", "/api/work-orders/2147483000/quality-check", { cookie: cookies.get("workshop_manager"), body: { result: "passed" } });
    expect(res.status).toBe(404);
  });

  it("valide : OT reste terminé, qc posé par le serveur, événement ciblé", async () => {
    const id = await newWorkOrder("completed");
    const broadcast = vi.fn();
    (global as any).broadcastUpdate = broadcast;
    const res = await call("POST", `/api/work-orders/${id}/quality-check`, { cookie: cookies.get("workshop_manager"), body: { result: "passed", qcBy: 1 } });
    expect(res.status).toBe(200);
    const parsed = qualityCheckResponseSchema.parse(res.body);
    expect(parsed.qcStatus).toBe("passed");
    const [qc] = await db.select().from(workOrderQuality).where(eq(workOrderQuality.id, id));
    expect(qc.qcStatus).toBe("passed");
    expect(qc.qcBy).toBe(parsed.qcBy);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(row.status).toBe("completed");
    expect(broadcast).toHaveBeenCalledWith("work_order_updated", expect.objectContaining({ workOrderId: id, scope: expect.objectContaining({ type: "roles" }) }));
  });

  it("rejette : retour en cours (jamais pending) avec motif conservé", async () => {
    const id = await newWorkOrder("completed");
    const res = await call("POST", `/api/work-orders/${id}/quality-check`, { cookie: cookies.get("workshop_manager"), body: { result: "failed", reason: "Fuite persistante" } });
    expect(res.status).toBe(200);
    expect(res.body.qcReason).toBe("Fuite persistante");
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(row.status).toBe("in_progress");
  });
});
