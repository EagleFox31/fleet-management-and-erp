import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts, partsUsed, vehicles, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * PATCH /api/technician/work-orders/:id/status
 * Le technicien ne sort jamais une pièce du stock lui-même : il la demande, le magasin la sort.
 * Le statut ne revient pas en arrière, et un kilométrage inférieur est refusé, pas ignoré.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
let technicianId = 0;
let otherTechnicianId = 0;
let cookie = "";
let vehicleId = 0;

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function newWorkOrder(status: "pending" | "in_progress" | "completed" | "cancelled", technician = technicianId) {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: "TEST OT statut technicien", status, technicianId: technician })
    .returning();
  workOrderIds.push(row.id);
  return row.id;
}

async function statusOf(id: number) {
  const [row] = await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, id));
  return row.status;
}

async function mileageOfVehicle() {
  const [row] = await db.select({ mileage: vehicles.mileage }).from(vehicles).where(eq(vehicles.id, vehicleId));
  return row.mileage;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const vehicle = await createTestVehicle({ mileage: 100000 });
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);

  const technician = await createTestUser({ role: "technician" });
  const other = await createTestUser({ role: "technician" });
  technicianId = technician.id;
  otherTechnicianId = other.id;
  ids.userIds.push(technician.id, other.id);

  const login = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: technician.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PATCH /api/technician/work-orders/:id/status", () => {
  it("refuse des pièces envoyées par le technicien : ni ligne sur l'OT, ni sortie de stock, ni changement de statut", async () => {
    const part = await createTestPart({ quantity: 10 });
    ids.partIds.push(part.id);
    const id = await newWorkOrder("in_progress");

    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, {
      status: "completed",
      partsUsed: [{ partId: String(part.id), quantity: 2 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/magasin/i);
    const [stock] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(10);
    const lines = await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, id));
    expect(lines).toHaveLength(0);
    expect(await statusOf(id)).toBe("in_progress");
  });

  it("refuse le retour d'un OT terminé vers « en cours » (409)", async () => {
    const id = await newWorkOrder("completed");
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, { status: "in_progress" });
    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe("completed");
  });

  it("refuse toute modification d'un OT annulé (409)", async () => {
    const id = await newWorkOrder("cancelled");
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, { status: "completed" });
    expect(res.status).toBe(409);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("refuse un statut inconnu (400)", async () => {
    const id = await newWorkOrder("pending");
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, { status: "n_importe_quoi" });
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
  });

  it("refuse un kilométrage inférieur à celui du véhicule, sans rien écrire (400)", async () => {
    const id = await newWorkOrder("in_progress");
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, { status: "completed", mileageUpdate: 90000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/kilométrage/i);
    expect(await statusOf(id)).toBe("in_progress");
    expect(await mileageOfVehicle()).toBe(100000);
  });

  it("refuse l'OT d'un autre technicien (403)", async () => {
    const id = await newWorkOrder("pending", otherTechnicianId);
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, { status: "in_progress" });
    expect(res.status).toBe(403);
  });

  it("démarre l'OT, enregistre le diagnostic et le kilométrage", async () => {
    const id = await newWorkOrder("pending");
    const res = await call("PATCH", `/api/technician/work-orders/${id}/status`, {
      status: "in_progress",
      notes: "Fuite au joint de culasse",
      mileageUpdate: 100250,
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    expect(row.status).toBe("in_progress");
    expect(row.diagnosis).toBe("Fuite au joint de culasse");
    expect(row.startDate).not.toBeNull();
    expect(await mileageOfVehicle()).toBe(100250);
  }, 30000); // démarrer l'OT déclenche l'automatisation du statut véhicule : plusieurs allers-retours Neon
});
