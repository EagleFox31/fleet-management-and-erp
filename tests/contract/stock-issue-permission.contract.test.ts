import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  alerts,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  users,
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
 * Droit de sortie du chef d'atelier : il sort une pièce reçue en dérogation
 * motivée (magasin fermé), et l'administrateur peut lui retirer ce droit, puis
 * le lui rendre. Retiré, la sortie est refusée (403) et le stock reste intact.
 * Seul l'administrateur modifie ce droit. Écrit en base ; tout est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

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
  return { status: response.status, body };
}

async function userWithSession(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

/** Une pièce en stock et une demande reçue au magasin, prête à sortir. */
async function receivedRequirement(requestedBy: number) {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: 3, unitPrice: "5000.00" });
  ids.partIds.push(part.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST droit de sortie", status: "in_progress" })
    .returning();
  workOrderIds.push(workOrder.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({
      partId: part.id,
      workOrderId: workOrder.id,
      vehicleId: vehicle.id,
      quantityNeeded: 1,
      urgency: "high",
      reason: "TEST droit de sortie",
      status: "received",
      requestedBy,
    })
    .returning();
  return { part, workOrder, requirement };
}

const OVERRIDE = { overrideReason: "Magasin fermé, intervention de nuit urgente" };

async function stockOf(partId: number) {
  const [row] = await db.select().from(parts).where(eq(parts.id, partId));
  return row.quantity;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
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
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Droit de sortie du chef d'atelier", { timeout: 120000 }, () => {
  it("par défaut le chef d'atelier sort une pièce reçue en dérogation motivée", async () => {
    const chef = await userWithSession("workshop_manager");
    const { part, workOrder, requirement } = await receivedRequirement(chef.user.id);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {
      cookie: chef.cookie,
      body: OVERRIDE,
    });

    expect(res.status).toBe(200);
    expect(await stockOf(part.id)).toBe(2);
  });

  it("l'admin retire le droit : sortie refusée (403), stock intact ; rendu : la sortie repasse", async () => {
    const admin = await userWithSession("admin");
    const chef = await userWithSession("workshop_manager");

    const revoke = await call("PATCH", `/api/users/${chef.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: false },
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body).toMatchObject({ id: chef.user.id, canIssueStock: false });
    const [stored] = await db.select().from(users).where(eq(users.id, chef.user.id));
    expect(stored.canIssueStock).toBe(false);

    const { part, workOrder, requirement } = await receivedRequirement(chef.user.id);
    const refused = await call(
      "POST",
      `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`,
      { cookie: chef.cookie, body: OVERRIDE },
    );
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/retiré par l'administrateur/);
    expect(await stockOf(part.id)).toBe(3);
    const [still] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(still.status).toBe("received");

    const restore = await call("PATCH", `/api/users/${chef.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: true },
    });
    expect(restore.status).toBe(200);

    const again = await call("POST", `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {
      cookie: chef.cookie,
      body: OVERRIDE,
    });
    expect(again.status).toBe(200);
    expect(await stockOf(part.id)).toBe(2);
  });

  it("seul l'admin modifie ce droit, et seulement pour un chef d'atelier", async () => {
    const chef = await userWithSession("workshop_manager");
    const other = await userWithSession("workshop_manager");
    const admin = await userWithSession("admin");
    const warehouse = await userWithSession("warehouse");

    const byChef = await call("PATCH", `/api/users/${other.user.id}/stock-issue-permission`, {
      cookie: chef.cookie,
      body: { canIssueStock: false },
    });
    expect(byChef.status).toBe(403);

    const onWarehouse = await call("PATCH", `/api/users/${warehouse.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: false },
    });
    expect(onWarehouse.status).toBe(400);

    const badBody = await call("PATCH", `/api/users/${other.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: "non" },
    });
    expect(badBody.status).toBe(400);

    const unknown = await call("PATCH", `/api/users/999999999/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: false },
    });
    expect(unknown.status).toBe(404);

    const [stored] = await db.select().from(users).where(eq(users.id, other.user.id));
    expect(stored.canIssueStock).toBe(true);
  });

  it("le retrait ne touche pas le magasinier, qui sort de plein droit", async () => {
    const warehouse = await userWithSession("warehouse");
    const chef = await userWithSession("workshop_manager");
    const { part, workOrder, requirement } = await receivedRequirement(chef.user.id);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {
      cookie: warehouse.cookie,
      body: {},
    });

    expect(res.status).toBe(200);
    expect(await stockOf(part.id)).toBe(2);
  });

  it("le technicien ne sort jamais, même en dérogation motivée : 403, stock intact", async () => {
    const technician = await userWithSession("technician");
    const { part, workOrder, requirement } = await receivedRequirement(technician.user.id);

    const res = await call("POST", `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`, {
      cookie: technician.cookie,
      body: OVERRIDE,
    });

    expect(res.status).toBe(403);
    expect(await stockOf(part.id)).toBe(3);
    const [stored] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(stored.status).toBe("received");
  });

  it("réglage du droit : sans session 401, id invalide 400, technicien 400, utilisateur supprimé 404", async () => {
    const admin = await userWithSession("admin");
    const chef = await userWithSession("workshop_manager");
    const technician = await userWithSession("technician");
    const body = { canIssueStock: false };

    const anonymous = await call("PATCH", `/api/users/${chef.user.id}/stock-issue-permission`, { body });
    expect(anonymous.status).toBe(401);

    const badId = await call("PATCH", `/api/users/abc/stock-issue-permission`, { cookie: admin.cookie, body });
    expect(badId.status).toBe(400);

    // Le technicien n'a pas ce réglage : on ne peut pas lui accorder la sortie.
    const onTechnician = await call("PATCH", `/api/users/${technician.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body: { canIssueStock: true },
    });
    expect(onTechnician.status).toBe(400);

    const deleted = await userWithSession("workshop_manager");
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
    const onDeleted = await call("PATCH", `/api/users/${deleted.user.id}/stock-issue-permission`, {
      cookie: admin.cookie,
      body,
    });
    expect(onDeleted.status).toBe(404);

    const rows = await db.select().from(users).where(inArray(users.id, [chef.user.id, deleted.user.id]));
    expect(rows.every((u) => u.canIssueStock === true)).toBe(true);
  });
});
