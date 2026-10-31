import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { bookingConflictResponseSchema } from "../../shared/contracts/work-order-booking";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/** Double affectation (T-23b): 409 sans écriture, PATCH sans changement de créneau accepté. */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("garde de double affectation des OT", { timeout: 180000 }, () => {
  it("refuse le chevauchement en 409 sans écrire, laisse passer le reste", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    const tech = await createTestUser({ role: "technician" });
    ids.userIds.push(manager.id, tech.id);
    const [v1, v2] = [await createTestVehicle(), await createTestVehicle()];
    ids.vehicleIds.push(v1.id, v2.id);
    const res = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: manager.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0];

    const [first] = await db
      .insert(workOrders)
      .values({
        vehicleId: v1.id,
        title: "TEST affectation A",
        status: "in_progress",
        technicianId: tech.id,
        startDate: new Date("2031-03-01T08:00:00Z"),
        endDate: new Date("2031-03-01T12:00:00Z"),
      })
      .returning();
    workOrderIds.push(first.id);
    const count = async () => (await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.technicianId, tech.id))).length;

    // Création chevauchante, même technicien: 409, corps conforme au contrat, rien d'écrit.
    const conflict = await call("POST", "/api/work-orders", cookie, {
      vehicleId: v2.id,
      title: "TEST affectation B",
      technicianId: tech.id,
      startDate: "2031-03-01T10:00:00Z",
      endDate: "2031-03-01T14:00:00Z",
    });
    expect(conflict.status).toBe(409);
    expect(bookingConflictResponseSchema.safeParse(conflict.body).success).toBe(true);
    expect(conflict.body.conflicts[0]).toMatchObject({ kind: "technician", workOrderId: first.id });
    expect(await count()).toBe(1);

    // Second OT hors créneau, puis déplacé sur le créneau du premier: refusé, base inchangée.
    const [second] = await db
      .insert(workOrders)
      .values({
        vehicleId: v2.id,
        title: "TEST affectation C",
        status: "pending",
        technicianId: tech.id,
        startDate: new Date("2031-03-02T08:00:00Z"),
        endDate: new Date("2031-03-02T12:00:00Z"),
      })
      .returning();
    workOrderIds.push(second.id);
    const moved = await call("PATCH", `/api/work-orders/${second.id}`, cookie, { startDate: "2031-03-01T09:00:00Z" });
    expect(moved.status).toBe(409);
    const [unchanged] = await db.select().from(workOrders).where(eq(workOrders.id, second.id));
    expect(unchanged.startDate?.toISOString()).toBe("2031-03-02T08:00:00.000Z");

    // PATCH sans changement de créneau: la garde ne s'en mêle pas.
    const rename = await call("PATCH", `/api/work-orders/${second.id}`, cookie, { description: "note" });
    expect(rename.status).toBe(200);
  });
});
