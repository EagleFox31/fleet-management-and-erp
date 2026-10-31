import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { activityLogs, workOrders } from "../../shared/schema";
import { workOrderAuditTrailPath, workOrderAuditTrailResponseSchema } from "../../shared/contracts/work-order-audit-trail";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-39 : historique d'un ordre de travail (vue du journal d'audit). */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
let workOrderId = 0;
let otherWorkOrderId = 0;
const logIds: number[] = [];

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

async function get(path: string, role?: string) {
  const res = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "work-order-audit-trail=on";
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const tech = await login("technician");
  await login("client");

  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [wo, other] = await db
    .insert(workOrders)
    .values([
      { vehicleId: vehicle.id, title: "t39 audit trail" },
      { vehicleId: vehicle.id, title: "t39 autre OT" },
    ])
    .returning();
  workOrderId = wo.id;
  otherWorkOrderId = other.id;

  const t0 = Date.now() - 60_000;
  const rows = await db
    .insert(activityLogs)
    .values([
      { userId: tech.id, action: "UPDATE", entityType: "work_order", entityId: wo.id, method: "PATCH", path: `/work-orders/${wo.id}`, details: { status: "in_progress", password: "secret" }, createdAt: new Date(t0 + 2000) },
      { userId: tech.id, action: "CREATE", entityType: "work_order", entityId: wo.id, method: "POST", path: "/work-orders", details: { title: "t39" }, createdAt: new Date(t0) },
      { userId: tech.id, action: "UPDATE", entityType: "work_order", entityId: other.id, method: "PATCH", path: `/work-orders/${other.id}`, details: null, createdAt: new Date(t0 + 1000) },
      { userId: tech.id, action: "UPDATE", entityType: "part", entityId: wo.id, method: "PATCH", path: `/parts/${wo.id}`, details: null, createdAt: new Date(t0 + 1500) },
    ])
    .returning({ id: activityLogs.id });
  logIds.push(...rows.map((r) => r.id));
}, 120000);

afterAll(async () => {
  delete process.env.FEATURE_FLAGS;
  if (logIds.length) await db.delete(activityLogs).where(inArray(activityLogs.id, logIds));
  for (const id of [workOrderId, otherWorkOrderId]) if (id) await db.delete(workOrders).where(eq(workOrders.id, id));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/work-orders/:id/audit-trail", { timeout: 120000 }, () => {
  it("renvoie 404 quand le drapeau est coupe", async () => {
    process.env.FEATURE_FLAGS = "work-order-audit-trail=off";
    try {
      expect((await get(workOrderAuditTrailPath(workOrderId), "technician")).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "work-order-audit-trail=on";
    }
  });

  it("refuse sans session (401) et le client (403)", async () => {
    expect((await get(workOrderAuditTrailPath(workOrderId))).status).toBe(401);
    expect((await get(workOrderAuditTrailPath(workOrderId), "client")).status).toBe(403);
  });

  it("sert au personnel les seules lignes de cet OT, du plus ancien au plus recent, secrets masques", async () => {
    const res = await get(workOrderAuditTrailPath(workOrderId), "technician");
    expect(res.status).toBe(200);
    const parsed = workOrderAuditTrailResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    const rows = parsed.success ? parsed.data : [];
    expect(rows.map((r) => r.action)).toEqual(["create", "update"]);
    expect(rows.every((r) => r.entityType === "work_order" && r.entityId === String(workOrderId))).toBe(true);
    expect(rows[1].details).toEqual({ status: "in_progress", password: "***" });
    expect(rows[0].userName).toBeTruthy();
  });

  it("renvoie 404 pour un OT inconnu", async () => {
    const res = await get(workOrderAuditTrailPath(2_000_000_000), "technician");
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/introuvable/i);
  });

  it("renvoie 400 pour un id invalide ou hors plage integer", async () => {
    for (const bad of ["abc", "0", "-3", "99999999999999999999", "2147483648"]) {
      expect((await get(`/api/work-orders/${bad}/audit-trail`, "technician")).status, bad).toBe(400);
    }
  });
});
