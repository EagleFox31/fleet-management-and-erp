import { createServer, type Server } from "http";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirements, parts, partsStockMovements, partsUsed, workOrders } from "../../shared/schema";
import { STATUS_MESSAGES } from "../../shared/errors";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { leakText } from "../support/api-error";

/**
 * Niveau C.
 * - Contrat d'erreur : toute réponse d'erreur porte `message` lisible, `code`
 *   et `requestId`, et l'en-tête `X-Request-Id` permet de retrouver la trace.
 * - T7 : deux sorties de stock simultanées pour la même demande ne sortent
 *   la pièce qu'une fois.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const requirementIds: number[] = [];

async function call(method: string, path: string, options: { body?: unknown; rawBody?: string; cookie?: string } = {}) {
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function login(username: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", { body: { username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError/);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
  }
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("contrat d'erreur de l'API", { timeout: 120000 }, () => {
  it("401 sans session : message, code et référence", async () => {
    const res = await call("GET", "/api/work-orders");
    expect(res.status).toBe(401);
    expectErrorContract(res, "UNAUTHENTICATED");
  });

  it("un JSON mal formé donne une 400 lisible, pas une page d'erreur Express", async () => {
    const res = await call("POST", "/api/auth/login", { rawBody: "{pas du json" });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(res.body.message).toBe("Les données envoyées sont illisibles.");
  });

  it("garde un identifiant de requête fourni par l'appelant", async () => {
    const response = await fetch(baseUrl + "/api/work-orders", { headers: { "X-Request-Id": "trace-abc-123" } });
    const body = await response.json();
    expect(response.headers.get("x-request-id")).toBe("trace-abc-123");
    expect(body.requestId).toBe("trace-abc-123");
  });
});

describe("PATCH demande de pièce : champs tenus par le serveur (T4)", { timeout: 120000 }, () => {
  it("ignore requestedBy envoyé par le client", async () => {
    const [technician, warehouse] = await Promise.all([
      createTestUser({ role: "technician" }),
      createTestUser({ role: "warehouse" }),
    ]);
    ids.userIds.push(technician.id, warehouse.id);
    const part = await createTestPart({ quantity: 1 });
    ids.partIds.push(part.id);
    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId: part.id, quantityNeeded: 1, reason: "TEST T4", status: "pending", requestedBy: technician.id })
      .returning();
    requirementIds.push(requirement.id);

    const cookie = await login(warehouse.username);
    const res = await call("PATCH", `/api/part-requirements/${requirement.id}`, {
      cookie,
      body: { notes: "TEST T4 note", requestedBy: warehouse.id },
    });
    expect(res.status).toBe(200);

    const [stored] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(stored.notes).toBe("TEST T4 note");
    expect(stored.requestedBy).toBe(technician.id);
  });
});

describe("sortie de stock vers l'OT : double soumission", { timeout: 240000 }, () => {
  it("deux sorties simultanées ne sortent la pièce qu'une fois", async () => {
    const [technician, warehouse] = await Promise.all([
      createTestUser({ role: "technician" }),
      createTestUser({ role: "warehouse" }),
    ]);
    ids.userIds.push(technician.id, warehouse.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST sortie double", status: "in_progress", technicianId: technician.id })
      .returning();
    workOrderIds.push(workOrder.id);
    const [requirement] = await db
      .insert(partRequirements)
      .values({
        partId: part.id,
        workOrderId: workOrder.id,
        quantityNeeded: 2,
        reason: "TEST sortie double",
        status: "received",
        requestedBy: technician.id,
      })
      .returning();
    requirementIds.push(requirement.id);

    const [warehouseCookie, technicianCookie] = await Promise.all([login(warehouse.username), login(technician.username)]);
    const path = `/api/work-orders/${workOrder.id}/part-requirements/${requirement.id}/issue`;

    const forbidden = await call("POST", path, { cookie: technicianCookie, body: {} });
    expect(forbidden.status).toBe(403);
    expectErrorContract(forbidden, "FORBIDDEN");

    const results = await Promise.all([
      call("POST", path, { cookie: warehouseCookie, body: {} }),
      call("POST", path, { cookie: warehouseCookie, body: {} }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);
    const refused = results.find((r) => r.status !== 200)!;
    expect(refused.body.message).not.toBe(STATUS_MESSAGES.INTERNAL);

    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(3);
    const used = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrder.id));
    expect(used).toHaveLength(1);
    const outs = await db
      .select()
      .from(partsStockMovements)
      .where(and(eq(partsStockMovements.partId, part.id), eq(partsStockMovements.movementType, "out")));
    expect(outs).toHaveLength(1);
    expect(outs[0].createdBy).toBe(warehouse.id);
  });

  it("un stock devenu insuffisant annule la sortie et garde la demande reçue", async () => {
    const [technician, warehouse] = await Promise.all([
      createTestUser({ role: "technician" }),
      createTestUser({ role: "warehouse" }),
    ]);
    ids.userIds.push(technician.id, warehouse.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const part = await createTestPart({ quantity: 3 });
    ids.partIds.push(part.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST stock concurrent", status: "in_progress", technicianId: technician.id })
      .returning();
    workOrderIds.push(workOrder.id);
    const rows = await db
      .insert(partRequirements)
      .values(
        [0, 1].map(() => ({
          partId: part.id,
          workOrderId: workOrder.id,
          quantityNeeded: 2,
          reason: "TEST stock concurrent",
          status: "received" as const,
          requestedBy: technician.id,
        })),
      )
      .returning();
    requirementIds.push(...rows.map((r) => r.id));

    const cookie = await login(warehouse.username);
    // Deux demandes différentes sur la même pièce : 2 + 2 > 3 disponibles.
    const results = await Promise.all(
      rows.map((r) => call("POST", `/api/work-orders/${workOrder.id}/part-requirements/${r.id}/issue`, { cookie, body: {} })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);

    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(1);
    const statuses = (await db.select().from(partRequirements).where(inArray(partRequirements.id, rows.map((r) => r.id)))).map((r) => r.status).sort();
    expect(statuses).toEqual(["issued", "received"]);
  });
});
