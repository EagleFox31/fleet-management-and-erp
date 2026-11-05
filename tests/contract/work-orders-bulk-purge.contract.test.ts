import { createServer, type Server } from "http";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { activityLogs, partRequirements, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Purge des OT en attente non assignés (`DELETE /api/work-orders/bulk-pending-unassigned`,
 * admin seul). La purge porte sur toute la base : les contrats tournent en série et chaque
 * fichier nettoie ses OT, les assertions ne portent que sur les OT créés ici.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const PATH = "/api/work-orders/bulk-pending-unassigned";

async function sessionOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

async function workOrder(vehicleId: number, status: (typeof workOrders.$inferInsert)["status"], technicianId: number | null) {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: `TEST purge ${status}`, status, technicianId })
    .returning({ id: workOrders.id });
  workOrderIds.push(row.id);
  return row.id;
}

async function remaining(): Promise<number[]> {
  const rows = await db.select({ id: workOrders.id }).from(workOrders).where(inArray(workOrders.id, workOrderIds));
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (workOrderIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("DELETE /api/work-orders/bulk-pending-unassigned : purge", () => {
  it("hors admin : 401 sans session, 403 pour le chef d'atelier, rien n'est supprimé", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const target = await workOrder(vehicle.id, "pending", null);
    const chef = await sessionOf("workshop_manager");

    expect((await fetch(baseUrl + PATH, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(baseUrl + PATH, { method: "DELETE", headers: { Cookie: chef.cookie } })).status).toBe(403);
    expect(await remaining()).toContain(target);
  });

  it("supprime les seuls OT en attente non assignés, garde les autres et ceux qui portent une demande de pièce", async () => {
    const admin = await sessionOf("admin");
    const technician = await sessionOf("technician");
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart({ quantity: 2 });
    ids.partIds.push(part.id);

    const purged = [await workOrder(vehicle.id, "pending", null), await workOrder(vehicle.id, "pending", null)];
    const kept = [
      await workOrder(vehicle.id, "pending", technician.user.id),
      await workOrder(vehicle.id, "in_progress", null),
      await workOrder(vehicle.id, "completed", null),
    ];
    // OT en attente non assigné mais qui porte une demande de pièce approuvée : la demande l'emporte.
    const withRequirement = await workOrder(vehicle.id, "pending", null);
    const [requirement] = await db
      .insert(partRequirements)
      .values({
        partId: part.id,
        workOrderId: withRequirement,
        vehicleId: vehicle.id,
        quantityNeeded: 1,
        reason: "TEST purge",
        status: "approved",
        requestedBy: technician.user.id,
      })
      .returning({ id: partRequirements.id });

    const res = await fetch(baseUrl + PATH, { method: "DELETE", headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();

    const left = await remaining();
    for (const id of purged) expect(left).not.toContain(id);
    for (const id of kept) expect(left).toContain(id);
    expect(left).toContain(withRequirement);
    const [stillThere] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(stillThere).toMatchObject({ status: "approved", workOrderId: withRequirement });

    expect(body.deleted).toBeGreaterThanOrEqual(purged.length);
    expect(body.failed).toBeGreaterThanOrEqual(1);
    expect(body.attempted).toBe(body.deleted + body.failed);

    const logged = await db
      .select({ entityId: activityLogs.entityId })
      .from(activityLogs)
      .where(and(eq(activityLogs.userId, admin.user.id), eq(activityLogs.action, "DELETE"), eq(activityLogs.entityType, "work_order")));
    expect(logged.map((l) => l.entityId).sort()).toEqual(expect.arrayContaining([...purged].sort()));
    expect(logged.map((l) => l.entityId)).not.toContain(withRequirement);
  });
});
