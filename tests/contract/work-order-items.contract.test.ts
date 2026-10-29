import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrderItems, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lignes de travail d'un OT: deux techniciens, des heures, aucun montant.
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
  // Les lignes partent avec l'OT (cascade), mais on ne compte pas dessus.
  if (workOrderIds.length > 0) {
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

// Trois comptes, véhicule, OT, trois sessions puis une dizaine d'appels: nombreux allers-retours Neon.
describe("lignes de travail d'un OT", { timeout: 180000 }, () => {
  it("saisit, totalise, garde les droits et ne touche pas au coût", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    const techA = await createTestUser({ role: "technician" });
    const techB = await createTestUser({ role: "technician" });
    ids.userIds.push(manager.id, techA.id, techB.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST travaux OT", status: "in_progress", technicianId: techA.id })
      .returning();
    workOrderIds.push(workOrder.id);
    const [managerCookie, cookieA, cookieB] = await Promise.all([
      login(manager.username),
      login(techA.username),
      login(techB.username),
    ]);

    // Une ligne sans libellé ni poste catalogue est illisible: refusée.
    const invalid = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "  ", actualHours: "1" },
    });
    expect(invalid.status).toBe(400);
    expect(typeof invalid.body?.message).toBe("string");

    const first = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "Vidange moteur", technicianId: techA.id, actualHours: "1.5", status: "done" },
    });
    expect(first.status).toBe(201);

    // Seconde ligne, autre technicien, pas encore mesurée.
    const second = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "Contrôle freins", technicianId: techB.id, estimatedHours: 2, status: "pending" },
    });
    expect(second.status).toBe(201);
    expect(second.body.items).toHaveLength(2);
    // Une ligne sans heures réelles est exclue du total, pas comptée à zéro.
    expect(second.body.totals.actualHours).toBe(1.5);
    expect(second.body.totals.unmeasuredLineCount).toBe(1);

    // Le technicien B n'est pas celui de l'OT.
    const refused = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: cookieB,
      body: { customLabel: "Tentative", actualHours: 1 },
    });
    expect(refused.status).toBe(403);

    const list = await call("GET", `/api/work-orders/${workOrder.id}/items`, { cookie: cookieA });
    expect(list.status).toBe(200);
    const freins = list.body.items.find((item: { label: string }) => item.label === "Contrôle freins");
    expect(freins.technicianName).toBeTruthy();

    const patched = await call("PATCH", `/api/work-order-items/${freins.id}`, {
      cookie: cookieA,
      body: { actualHours: 2.5, status: "done" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.workOrderId).toBe(workOrder.id);
    expect(patched.body.totals.actualHours).toBe(4);
    expect(patched.body.totals.unmeasuredLineCount).toBe(0);

    const removed = await call("DELETE", `/api/work-order-items/${freins.id}`, { cookie: managerCookie });
    expect(removed.status).toBe(200);
    expect(removed.body.items).toHaveLength(1);

    // Des heures, jamais un montant: le coût de l'OT reste intact.
    const [after] = await db.select().from(workOrders).where(eq(workOrders.id, workOrder.id));
    expect(after.cost).toEqual(workOrder.cost);
  });
});
