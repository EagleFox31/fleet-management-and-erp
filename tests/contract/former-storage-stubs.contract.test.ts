import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleDocuments, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, routes servies par d'anciens bouchons de `server/storage.ts`.
 * - DELETE /api/documents/:id répondait 204 sans rien supprimer ;
 * - GET /api/work-orders/technician/:id répondait toujours [] (T1 : un
 *   technicien ne lit que ses propres OT) ;
 * - GET /api/work-orders pour un client répondait toujours une liste vide.
 */

const ROLES: TestUserRole[] = ["workshop_manager", "technician", "warehouse", "client"];

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();
const sessionUserIds = new Map<TestUserRole, number>();
const workOrderIds: number[] = [];
const uploadsSubdir = uniqueTestToken("docs");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);

async function call(method: string, path: string, options: { cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: options.cookie ? { Cookie: options.cookie } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
}

async function newVehicle(ownerId?: number) {
  const vehicle = await createTestVehicle({ ownerId });
  ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

async function newWorkOrder(vehicleId: number, technicianId?: number) {
  const [row] = await db.insert(workOrders).values({ vehicleId, technicianId, title: "TEST OT", status: "pending" }).returning();
  workOrderIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ROLES) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    sessionUserIds.set(role, user.id);
    const res = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  // Documents : supprimés en cascade avec le véhicule.
  await cleanupCreated(ids);
  rmSync(uploadsDir, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("DELETE /api/documents/:id", { timeout: 60000 }, () => {
  async function createDocument() {
    mkdirSync(uploadsDir, { recursive: true });
    const name = `${uniqueTestToken("file")}.pdf`;
    const file = join(uploadsDir, name);
    writeFileSync(file, "TEST");
    const [row] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: (await newVehicle()).id,
        name: "TEST doc",
        type: "autre",
        filename: name,
        filesize: 4,
        fileType: "application/pdf",
        filePath: join("uploads", uploadsSubdir, name),
      })
      .returning();
    return { doc: row, file };
  }

  async function documentExists(id: number) {
    return (await db.select({ id: vehicleDocuments.id }).from(vehicleDocuments).where(eq(vehicleDocuments.id, id))).length > 0;
  }

  it("chef d'atelier : 204, ligne et fichier supprimés (le bouchon ne supprimait rien)", async () => {
    const { doc, file } = await createDocument();
    const res = await call("DELETE", `/api/documents/${doc.id}`, { cookie: cookies.get("workshop_manager") });
    expect(res.status).toBe(204);
    expect(await documentExists(doc.id)).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("seconde suppression : 404 au contrat", async () => {
    const { doc } = await createDocument();
    await call("DELETE", `/api/documents/${doc.id}`, { cookie: cookies.get("workshop_manager") });
    const res = await call("DELETE", `/api/documents/${doc.id}`, { cookie: cookies.get("workshop_manager") });
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("T1 : technicien -> 403, document intact", async () => {
    const { doc, file } = await createDocument();
    const res = await call("DELETE", `/api/documents/${doc.id}`, { cookie: cookies.get("technician") });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
    expect(await documentExists(doc.id)).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  it("T1 : sans session -> 401", async () => {
    const { doc } = await createDocument();
    const res = await call("DELETE", `/api/documents/${doc.id}`);
    expect(res.status).toBe(401);
    expect(await documentExists(doc.id)).toBe(true);
  });
});

describe("GET /api/work-orders/technician/:id", { timeout: 60000 }, () => {
  it("technicien : ses propres OT, technicien joint (le bouchon renvoyait [])", async () => {
    const techId = sessionUserIds.get("technician")!;
    const vehicle = await newVehicle();
    const mine = await newWorkOrder(vehicle.id, techId);
    await newWorkOrder(vehicle.id);

    const res = await call("GET", `/api/work-orders/technician/${techId}`, { cookie: cookies.get("technician") });
    expect(res.status).toBe(200);
    expect(res.body.map((wo: { id: number }) => wo.id)).toContain(mine.id);
    expect(res.body.every((wo: { technicianId: number }) => wo.technicianId === techId)).toBe(true);
  });

  it("T1 : technicien qui lit les OT d'un autre -> 403", async () => {
    const otherId = sessionUserIds.get("workshop_manager")!;
    const res = await call("GET", `/api/work-orders/technician/${otherId}`, { cookie: cookies.get("technician") });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
  });

  it("chef d'atelier : lit les OT de n'importe quel technicien", async () => {
    const techId = sessionUserIds.get("technician")!;
    const assigned = await newWorkOrder((await newVehicle()).id, techId);
    const res = await call("GET", `/api/work-orders/technician/${techId}`, { cookie: cookies.get("workshop_manager") });
    expect(res.status).toBe(200);
    expect(res.body.map((wo: { id: number }) => wo.id)).toContain(assigned.id);
  });

  it("T1 : magasinier -> 403", async () => {
    const res = await call("GET", `/api/work-orders/technician/${sessionUserIds.get("technician")}`, { cookie: cookies.get("warehouse") });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
  });
});

describe("GET /api/work-orders pour un client", { timeout: 60000 }, () => {
  it("ne voit que les OT de ses véhicules (le bouchon renvoyait une liste vide)", async () => {
    const ownVehicle = await newVehicle(sessionUserIds.get("client"));
    const own = await newWorkOrder(ownVehicle.id);
    const foreign = await newWorkOrder((await newVehicle()).id);

    const res = await call("GET", "/api/work-orders", { cookie: cookies.get("client") });
    expect(res.status).toBe(200);
    const returned = res.body.workOrders.map((wo: { id: number }) => wo.id);
    expect(returned).toEqual([own.id]);
    expect(returned).not.toContain(foreign.id);
    expect(res.body.total).toBe(1);
  });
});
