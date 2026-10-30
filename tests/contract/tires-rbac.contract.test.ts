import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  activityLogs,
  tireInspections,
  tireRotationDetails,
  tireRotations,
  tires,
  vehicleTires,
  workOrders,
} from "../../shared/schema";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C — pneus, RBAC aligné sur la feuille PNEUMATIQUE (AGENTS.md §5) :
 * - TIR1 : fiche pneu en stock par `warehouse` / `admin`, suppression par `admin` ;
 * - TIR2 : suppression douce, la fiche reste en base mais sort du stock ;
 * - TIR3 : montage, rotation, démontage par `workshop_manager` ;
 * - TIR4 : inspection ouverte au `technician`.
 */

type Actor = "admin" | "warehouse" | "workshopManager" | "technician";
const ACTORS: Record<Actor, TestUserRole> = {
  admin: "admin",
  warehouse: "warehouse",
  workshopManager: "workshop_manager",
  technician: "technician",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const tireIds: number[] = [];

async function call(method: string, path: string, options: { body?: unknown; actor?: Actor } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.actor ? { Cookie: cookies.get(options.actor)! } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function expectForbidden(res: { status: number; body: any }) {
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("FORBIDDEN");
}

/** Corps tel que l'envoie l'assistant de création de fiche pneu. */
function tireForm(overrides: Record<string, unknown> = {}) {
  return {
    ...getDefaultTireFormValues(),
    brand: "TEST-MARQUE",
    model: uniqueTestToken("tire"),
    manufacturingWeek: "10",
    stockQuantity: 2,
    purchasePrice: 250000,
    supplier: "TEST fournisseur",
    location: "TEST rayon",
    ...overrides,
  };
}

async function seedTire(stockQuantity = 2): Promise<number> {
  const [row] = await db
    .insert(tires)
    .values({ brand: "TEST-MARQUE", model: uniqueTestToken("tire"), size: "315/80R22.5", stockQuantity })
    .returning();
  tireIds.push(row.id);
  return row.id;
}

async function tireRow(id: number) {
  const [row] = await db.select().from(tires).where(eq(tires.id, id));
  return row;
}

async function seedVehicle(): Promise<number> {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  return vehicle.id;
}

const mountBody = (tireId: number, position = "front_left") => ({
  tireId,
  position,
  installationDate: "2026-10-30",
  installationMileage: 1000,
});

async function seedMountedTire(): Promise<{ tireId: number; vehicleId: number; vehicleTireId: number }> {
  const tireId = await seedTire(1);
  const vehicleId = await seedVehicle();
  const [row] = await db.insert(vehicleTires).values({ vehicleId, ...mountBody(tireId) } as typeof vehicleTires.$inferInsert).returning();
  return { tireId, vehicleId, vehicleTireId: row.id };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 60000);

afterAll(async () => {
  if (ids.vehicleIds.length > 0) {
    const mounted = await db.select({ id: vehicleTires.id }).from(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
    const mountedIds = mounted.map((row) => row.id);
    if (mountedIds.length > 0) {
      await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, mountedIds));
      await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.vehicleTireId, mountedIds));
    }
    await db.delete(tireRotations).where(inArray(tireRotations.vehicleId, ids.vehicleIds));
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
    await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
  }
  if (tireIds.length > 0) {
    await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
    await db.delete(tires).where(inArray(tires.id, tireIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("TIR1 : fiche pneu en stock, magasin et admin", { timeout: 120000 }, () => {
  it.each(["warehouse", "admin"] as const)("%s crée une fiche, attribuée à son auteur même si le corps en prétend un autre", async (actor) => {
    const res = await call("POST", "/api/tires", {
      actor,
      body: tireForm({ createdBy: userIds.get("technician"), updatedBy: userIds.get("technician") }),
    });
    expect(res.status).toBe(201);
    tireIds.push(res.body.id);
    expect(res.body).toMatchObject({ createdBy: userIds.get(actor), updatedBy: userIds.get(actor), stockQuantity: 2 });
  });

  it.each(["workshopManager", "technician"] as const)("%s ne crée pas de fiche pneu", async (actor) => {
    expectForbidden(await call("POST", "/api/tires", { actor, body: tireForm() }));
  });

  it("le magasinier modifie la fiche ; le chef d'atelier est refusé", async () => {
    const id = await seedTire();
    const ok = await call("PATCH", `/api/tires/${id}`, { actor: "warehouse", body: { location: "TEST rayon B" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ location: "TEST rayon B", updatedBy: userIds.get("warehouse") });

    expectForbidden(await call("PATCH", `/api/tires/${id}`, { actor: "workshopManager", body: { location: "TEST rayon C" } }));
    expect((await tireRow(id)).location).toBe("TEST rayon B");
  });

  it("modifier une fiche inexistante répond 404", async () => {
    const res = await call("PATCH", "/api/tires/999999999", { actor: "warehouse", body: { location: "TEST" } });
    expect(res.status).toBe(404);
  });

  it("seul l'admin supprime ; une fiche inexistante répond 404", async () => {
    const id = await seedTire();
    expectForbidden(await call("DELETE", `/api/tires/${id}`, { actor: "warehouse" }));
    expect((await tireRow(id)).deletedAt).toBeNull();

    expect((await call("DELETE", "/api/tires/999999999", { actor: "admin" })).status).toBe(404);
  });
});

describe("TIR2 : suppression douce", { timeout: 120000 }, () => {
  it("la fiche reste en base, sort du stock et n'est plus montable ni modifiable", async () => {
    const id = await seedTire(3);
    const deleted = await call("DELETE", `/api/tires/${id}`, { actor: "admin" });
    expect(deleted.status).toBe(204);

    const row = await tireRow(id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.updatedBy).toBe(userIds.get("admin"));

    expect((await call("GET", `/api/tires/${id}`, { actor: "warehouse" })).status).toBe(404);
    const list = await call("GET", `/api/tires?search=${encodeURIComponent(row.model)}`, { actor: "warehouse" });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(row.model);

    const vehicleId = await seedVehicle();
    const mount = await call("POST", `/api/vehicles/${vehicleId}/tires`, { actor: "workshopManager", body: mountBody(id) });
    expect(mount.status).toBe(409);
    expect((await tireRow(id)).stockQuantity).toBe(3);

    expect((await call("PATCH", `/api/tires/${id}`, { actor: "warehouse", body: { location: "TEST" } })).status).toBe(404);
    expect((await call("DELETE", `/api/tires/${id}`, { actor: "admin" })).status).toBe(404);
  });

  it("un pneu monté ne se supprime pas : 409, message lisible", async () => {
    const { tireId } = await seedMountedTire();
    const res = await call("DELETE", `/api/tires/${tireId}`, { actor: "admin" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/monté|installé/);
    expect((await tireRow(tireId)).deletedAt).toBeNull();
  });
});

describe("TIR3 : montage, rotation, démontage par le chef d'atelier", { timeout: 120000 }, () => {
  it("montage : le chef d'atelier monte (stock -1), magasinier et technicien refusés", async () => {
    const tireId = await seedTire(2);
    const vehicleId = await seedVehicle();

    expectForbidden(await call("POST", `/api/vehicles/${vehicleId}/tires`, { actor: "warehouse", body: mountBody(tireId) }));
    expectForbidden(await call("POST", `/api/vehicles/${vehicleId}/tires`, { actor: "technician", body: mountBody(tireId) }));
    expect((await tireRow(tireId)).stockQuantity).toBe(2);

    const mounted = await call("POST", `/api/vehicles/${vehicleId}/tires`, { actor: "workshopManager", body: mountBody(tireId) });
    expect(mounted.status).toBe(201);
    expect(mounted.body).toMatchObject({ vehicleId, tireId, status: "active" });
    expect((await tireRow(tireId)).stockQuantity).toBe(1);
  });

  it("démontage : le chef d'atelier démonte, le magasinier est refusé ; un montage inconnu répond 404", async () => {
    const { vehicleTireId } = await seedMountedTire();
    expectForbidden(await call("PATCH", `/api/vehicle-tires/${vehicleTireId}/remove`, { actor: "warehouse", body: { removalMileage: 2000 } }));

    const removed = await call("PATCH", `/api/vehicle-tires/${vehicleTireId}/remove`, { actor: "workshopManager", body: { removalMileage: 2000 } });
    expect(removed.status).toBe(200);
    const [row] = await db.select().from(vehicleTires).where(eq(vehicleTires.id, vehicleTireId));
    expect(row).toMatchObject({ status: "removed", removalMileage: 2000 });

    const unknown = await call("PATCH", "/api/vehicle-tires/999999999/remove", { actor: "workshopManager", body: { removalMileage: 2000 } });
    expect(unknown.status).toBe(404);
  });

  it("rotation : le chef d'atelier la planifie (OT créé), le technicien est refusé", async () => {
    const vehicleId = await seedVehicle();
    const rotation = { vehicleId, rotationDate: "2026-10-30", rotationMileage: 5000, rotationType: "front_to_back" };

    expectForbidden(await call("POST", "/api/tire-rotations", { actor: "technician", body: { rotation } }));

    const res = await call("POST", "/api/tire-rotations", { actor: "workshopManager", body: { rotation } });
    expect(res.status).toBe(201);
    const rows = await db.select().from(tireRotations).where(eq(tireRotations.vehicleId, vehicleId));
    expect(rows).toEqual([expect.objectContaining({ performedBy: userIds.get("workshopManager") })]);
  });

  it("rotation invalide : 400, et aucun OT orphelin", async () => {
    const vehicleId = await seedVehicle();
    const res = await call("POST", "/api/tire-rotations", {
      actor: "workshopManager",
      body: { rotation: { vehicleId, rotationType: "front_to_back" } },
    });
    expect(res.status).toBe(400);
    expect(await db.select().from(workOrders).where(eq(workOrders.vehicleId, vehicleId))).toEqual([]);
  });
});

describe("TIR4 : inspection par le technicien", { timeout: 120000 }, () => {
  it("le technicien inspecte, en son nom ; le magasinier est refusé", async () => {
    const { vehicleTireId } = await seedMountedTire();
    const inspection = {
      vehicleTireId,
      inspectionDate: "2026-10-30",
      inspectionMileage: 1500,
      condition: "good",
      inspectedBy: userIds.get("admin"),
    };

    expectForbidden(await call("POST", "/api/tire-inspections", { actor: "warehouse", body: inspection }));

    const res = await call("POST", "/api/tire-inspections", { actor: "technician", body: inspection });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicleTireId, condition: "good", inspectedBy: userIds.get("technician") });
  });

  it("inspection invalide : 400 lisible, pas 500", async () => {
    const { vehicleTireId } = await seedMountedTire();
    const res = await call("POST", "/api/tire-inspections", { actor: "technician", body: { vehicleTireId, condition: "parfait" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});
