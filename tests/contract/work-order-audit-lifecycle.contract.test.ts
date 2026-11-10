import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, workOrders } from "../../shared/schema";
import { workOrderAuditTrailPath, workOrderAuditTrailResponseSchema } from "../../shared/contracts/work-order-audit-trail";
import { db } from "../../server/db";
import { setAuditSink } from "../../server/lib/audit";
import { dbAuditSink } from "../../server/lib/audit-db-sink";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Historique d'un OT complet : creation (id lu dans la reponse) puis statuts du technicien.
 * Sans regle d'audit sur ces deux routes, la chronologie serait incomplete et fausse.
 */
process.env.FEATURE_FLAGS = "work-order-audit-trail=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
let workOrderId = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user;
}

async function call(method: string, path: string, role: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookies.get(role)! },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitForAudit(expected: number) {
  for (let i = 0; i < 40; i++) {
    const rows = await db.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, workOrderId));
    if (rows.filter(Boolean).length >= expected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  setAuditSink(dbAuditSink);
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  await login("workshop_manager");
  const tech = await login("technician");
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const created = await call("POST", "/api/work-orders", "workshop_manager", {
    vehicleId: vehicle.id,
    title: "audit cycle de vie",
    technicianId: tech.id,
  });
  expect(created.status).toBeLessThan(300);
  workOrderId = created.body.id;
}, 180000);

afterAll(async () => {
  setAuditSink(null);
  if (workOrderId) {
    await db.delete(activityLogs).where(inArray(activityLogs.entityId, [workOrderId]));
    await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
  }
  await cleanupCreated(ids);
  delete process.env.FEATURE_FLAGS;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("historique d'un OT : creation, demarrage et fin par le technicien", { timeout: 120000 }, () => {
  it("liste les 3 entrees dans l'ordre, avec les statuts du technicien", async () => {
    expect((await call("PATCH", `/api/technician/work-orders/${workOrderId}/status`, "technician", { status: "in_progress" })).status).toBe(200);
    expect((await call("PATCH", `/api/technician/work-orders/${workOrderId}/status`, "technician", { status: "completed" })).status).toBe(200);
    await waitForAudit(3);

    const trail = await call("GET", workOrderAuditTrailPath(workOrderId), "workshop_manager");
    expect(trail.status).toBe(200);
    const rows = workOrderAuditTrailResponseSchema.parse(trail.body);
    expect(rows.map((r) => `${r.method} ${r.path?.replace(/\d+/, ":id")}`)).toEqual([
      "POST /api/work-orders",
      "PATCH /api/technician/work-orders/:id/status",
      "PATCH /api/technician/work-orders/:id/status",
    ]);
    expect(rows.map((r) => (r.details as { status?: string } | null)?.status)).toEqual([undefined, "in_progress", "completed"]);
  });
});
