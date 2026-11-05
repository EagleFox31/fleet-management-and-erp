import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partsUsed, workOrders } from "../../shared/schema";
import { ALL_APP_ROLES, WORK_ORDER_COST_READ_ROLES } from "../../shared/constants/roles";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Liste des pièces posées (`GET /api/parts-used`) : elle porte le prix unitaire, donc elle suit
 * les rôles coût (`WORK_ORDER_COST_READ_ROLES`). Chauffeur et client sont refusés.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
let usedId = 0;

async function cookieOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const list = (cookie?: string) => fetch(`${baseUrl}/api/parts-used`, { headers: cookie ? { Cookie: cookie } : {} });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const part = await createTestPart({ quantity: 5, unitPrice: "4321.37" });
  ids.partIds.push(part.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title: "TEST liste pièces posées", status: "in_progress" })
    .returning();
  workOrderIds.push(workOrder.id);
  const [used] = await db
    .insert(partsUsed)
    .values({ workOrderId: workOrder.id, partId: part.id, quantity: 1, unitPrice: "4321.37" })
    .returning();
  usedId = used.id;
});

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("GET /api/parts-used : liste avec prix unitaire", () => {
  it("sans session : 401", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(["driver", "client"] as const)("%s : 403, aucun prix dans la réponse", async (role) => {
    const res = await list(await cookieOf(role));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("4321.37");
  });

  it.each(["admin", "technician", "warehouse", "workshop_manager"] as const)("%s : 200 avec le prix unitaire", async (role) => {
    const res = await list(await cookieOf(role));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: number; unitPrice: string | number }>;
    const row = rows.find((r) => r.id === usedId);
    expect(row).toBeDefined();
    expect(Number(row!.unitPrice)).toBe(4321.37);
  });

  it("chaque rôle de l'application : 200 si rôle coût, 403 sinon", async () => {
    for (const role of ALL_APP_ROLES) {
      const res = await list(await cookieOf(role as TestUserRole));
      const expected = (WORK_ORDER_COST_READ_ROLES as readonly string[]).includes(role) ? 200 : 403;
      expect({ role, status: res.status }).toEqual({ role, status: expected });
    }
  });
});
