import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords, tireInspections, tireRotationDetails, tireRotations, tires, vehicleTires } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, cloison client sur les lectures pneus et lectures internes (lot A4, 3 novembre 2026).
 *
 * - GET /api/vehicle-tires : ouvert au client (le tableau des véhicules s'en sert), limité aux pneus
 *   de ses véhicules.
 * - Inspections, rotations, dernière inspection, détail de rotation, /api/tires*, /api/fault-catalog :
 *   personnel seul (technicien compris, AGENTS.md §5), aucun écran client ne les lit.
 * - Lectures masquées par un montage de server/api/index.ts (/suppliers, /warehouse, /fuel-card,
 *   /exports) : le client est refusé, ce qui justifie leur sortie de la liste gelée de routes-hygiene.
 * - /api/suppliers/:id/invoices/payment : rôles d'approvisionnement seulement.
 * - ?vehicleId= hors plage 32 bits : 400 ; ?vehicleId=B&vehicleId=A pour un client : 403.
 */

type Actor = "manager" | "technician" | "driver" | "warehouse" | "clientA" | "clientB" | "clientNoVehicle";
const ACTORS: Record<Actor, TestUserRole> = {
  manager: "workshop_manager",
  technician: "technician",
  driver: "driver",
  warehouse: "warehouse",
  clientA: "client",
  clientB: "client",
  clientNoVehicle: "client",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const tireIds: number[] = [];
const vehicleTireIds: number[] = [];
const inspectionIds: number[] = [];
const rotationIds: number[] = [];
const rotationDetailIds: number[] = [];
const fuelIds: number[] = [];
const OUT_OF_RANGE = "99999999999";
const UNKNOWN_VALID_ID = 2147483646;

let vehicleA = 0;
let vehicleB = 0;
let tireA = 0;
let vtA = 0;
let vtB = 0;
let latestInspectionA = 0;
let inspectionB = 0;
let rotationA = 0;
let rotationB = 0;

async function get(path: string, actor: Actor) {
  const response = await fetch(baseUrl + path, { headers: { Cookie: cookies.get(actor)! } });
  let body: unknown = await response.text();
  try {
    body = JSON.parse(body as string);
  } catch {
    // corps non JSON : conservé tel quel
  }
  return { status: response.status, body };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const userIds = new Map<Actor, number>();
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

  const a = await createTestVehicle({ ownerId: userIds.get("clientA")! });
  const b = await createTestVehicle({ ownerId: userIds.get("clientB")! });
  ids.vehicleIds.push(a.id, b.id);
  vehicleA = a.id;
  vehicleB = b.id;

  const today = new Date().toISOString().slice(0, 10);
  const [tire] = await db
    .insert(tires)
    .values({ brand: uniqueTestToken("pneu"), model: "TEST", size: "315/80R22.5" })
    .returning();
  tireIds.push(tire.id);
  tireA = tire.id;

  const mounted = await db
    .insert(vehicleTires)
    .values([
      { vehicleId: a.id, tireId: tire.id, position: "front_left", installationDate: today, installationMileage: 1000 },
      { vehicleId: b.id, tireId: tire.id, position: "front_right", installationDate: today, installationMileage: 2000 },
    ])
    .returning();
  vtA = mounted[0].id;
  vtB = mounted[1].id;
  vehicleTireIds.push(vtA, vtB);

  // deux inspections sur le pneu A : la dernière par date doit être renvoyée
  const inspections = await db
    .insert(tireInspections)
    .values([
      { vehicleTireId: vtA, inspectionDate: "2026-01-10", inspectionMileage: 1100, condition: "good" },
      { vehicleTireId: vtA, inspectionDate: "2026-02-10", inspectionMileage: 1200, condition: "fair" },
      { vehicleTireId: vtB, inspectionDate: "2026-01-15", inspectionMileage: 2100, condition: "excellent" },
    ])
    .returning();
  inspectionIds.push(...inspections.map((row) => row.id));
  latestInspectionA = inspections[1].id;
  inspectionB = inspections[2].id;

  const rotations = await db
    .insert(tireRotations)
    .values([
      { vehicleId: a.id, rotationDate: today, rotationMileage: 1300, rotationType: "front_to_back" },
      { vehicleId: b.id, rotationDate: today, rotationMileage: 2300, rotationType: "cross_rotation" },
    ])
    .returning();
  rotationIds.push(...rotations.map((row) => row.id));
  rotationA = rotations[0].id;
  rotationB = rotations[1].id;
  const details = await db
    .insert(tireRotationDetails)
    .values([
      { rotationId: rotationA, vehicleTireId: vtA, fromPosition: "front_left", toPosition: "rear_left_outer" },
      { rotationId: rotationB, vehicleTireId: vtB, fromPosition: "front_right", toPosition: "rear_right_outer" },
    ])
    .returning();
  rotationDetailIds.push(...details.map((row) => row.id));

  const fuel = await db
    .insert(fuelRecords)
    .values([
      { vehicleId: a.id, date: today, quantity: 10, cost: "1000", mileage: 1000 },
      { vehicleId: b.id, date: today, quantity: 20, cost: "2000", mileage: 2000 },
    ])
    .returning();
  fuelIds.push(...fuel.map((row) => row.id));
}, 60000);

afterAll(async () => {
  if (fuelIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, fuelIds));
  if (rotationDetailIds.length > 0) await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.id, rotationDetailIds));
  if (rotationIds.length > 0) await db.delete(tireRotations).where(inArray(tireRotations.id, rotationIds));
  if (inspectionIds.length > 0) await db.delete(tireInspections).where(inArray(tireInspections.id, inspectionIds));
  if (vehicleTireIds.length > 0) await db.delete(vehicleTires).where(inArray(vehicleTires.id, vehicleTireIds));
  if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const vehicleIdsOf = (body: unknown): number[] => (Array.isArray(body) ? body.map((r: { vehicleId: number }) => r.vehicleId) : []);

describe("GET /api/vehicle-tires : ouvert au client, limité à ses véhicules", () => {
  it("un client ne voit que les pneus montés sur ses véhicules", async () => {
    const a = await get("/api/vehicle-tires", "clientA");
    expect(a.status).toBe(200);
    expect(vehicleIdsOf(a.body)).toEqual([vehicleA]);
    const b = await get("/api/vehicle-tires", "clientB");
    expect(b.status).toBe(200);
    expect(vehicleIdsOf(b.body)).toEqual([vehicleB]);
  });

  it("un client sans véhicule reçoit une liste vide", async () => {
    const res = await get("/api/vehicle-tires", "clientNoVehicle");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("le personnel voit les pneus de tous les clients", async () => {
    for (const actor of ["manager", "technician"] as const) {
      const res = await get("/api/vehicle-tires", actor);
      expect(res.status).toBe(200);
      expect(vehicleIdsOf(res.body)).toEqual(expect.arrayContaining([vehicleA, vehicleB]));
    }
  });
});

const STAFF_ONLY = [
  "/api/tire-inspections",
  "/api/tire-inspections/recent",
  "/api/tire-inspections/{inspectionA}",
  "/api/tire-rotations",
  "/api/tire-rotations/{rotationA}/details",
  "/api/vehicle-tires/{vtA}/last-inspection",
  "/api/tires",
  "/api/tires/{tireA}",
  "/api/tires/statistics",
  "/api/tires/statistics-advanced",
  "/api/tires/low-stock",
  "/api/fault-catalog",
];
const resolvePath = (template: string) =>
  template
    .replace("{inspectionA}", String(latestInspectionA))
    .replace("{rotationA}", String(rotationA))
    .replace("{vtA}", String(vtA))
    .replace("{tireA}", String(tireA));

describe.each(STAFF_ONLY)("GET %s : personnel seul", (template) => {
  it("un client est refusé (403, corps sans détail technique)", async () => {
    for (const actor of ["clientA", "clientNoVehicle"] as const) {
      const res = await get(resolvePath(template), actor);
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    }
  });

  it("le technicien et le chef d'atelier sont admis", async () => {
    for (const actor of ["technician", "manager"] as const) {
      const res = await get(resolvePath(template), actor);
      expect(res.status, `${actor} ${template}`).toBe(200);
    }
  });
});

describe("dernière inspection et détail de rotation : l'identifiant est lu", () => {
  it("last-inspection renvoie la dernière inspection du pneu demandé, pas celle d'un autre", async () => {
    const a = await get(`/api/vehicle-tires/${vtA}/last-inspection`, "manager");
    expect(a.status).toBe(200);
    expect((a.body as { id: number }).id).toBe(latestInspectionA);
    const b = await get(`/api/vehicle-tires/${vtB}/last-inspection`, "technician");
    expect((b.body as { id: number }).id).toBe(inspectionB);
  });

  it("last-inspection : id inconnu 404, hors plage 32 bits 400", async () => {
    const unknown = await get(`/api/vehicle-tires/${UNKNOWN_VALID_ID}/last-inspection`, "manager");
    expect(apiErrorProblems(unknown.status, unknown.body, 404)).toEqual([]);
    const outOfRange = await get(`/api/vehicle-tires/${OUT_OF_RANGE}/last-inspection`, "manager");
    expect(apiErrorProblems(outOfRange.status, outOfRange.body, 400)).toEqual([]);
  });

  it("détail de rotation : mouvements de la rotation demandée", async () => {
    const a = await get(`/api/tire-rotations/${rotationA}/details`, "manager");
    expect(a.status).toBe(200);
    const body = a.body as { id: number; vehicleId: number; movements: { vehicleTireId: number; toPosition: string }[] };
    expect(body.id).toBe(rotationA);
    expect(body.vehicleId).toBe(vehicleA);
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0]).toMatchObject({ vehicleTireId: vtA, toPosition: "rear_left_outer" });
    const b = await get(`/api/tire-rotations/${rotationB}/details`, "manager");
    expect((b.body as { vehicleId: number }).vehicleId).toBe(vehicleB);
  });

  it("détail de rotation : id inconnu 404, hors plage 400", async () => {
    const unknown = await get(`/api/tire-rotations/${UNKNOWN_VALID_ID}/details`, "manager");
    expect(apiErrorProblems(unknown.status, unknown.body, 404)).toEqual([]);
    const outOfRange = await get(`/api/tire-rotations/${OUT_OF_RANGE}/details`, "manager");
    expect(apiErrorProblems(outOfRange.status, outOfRange.body, 400)).toEqual([]);
  });
});

const MOUNT_HIDDEN = [
  "/api/suppliers/summary",
  "/api/suppliers/top",
  "/api/warehouse/inventory-value",
  "/api/warehouse/most-used-parts",
  "/api/warehouse/parts-by-supplier",
  "/api/warehouse/reorder-alerts",
  "/api/warehouse/statistics",
  "/api/fuel-card/balance",
  "/api/fuel-card/history",
  "/api/fuel-card/monthly-stats",
  "/api/fuel-card/stats-by-client",
  "/api/exports/complete",
  "/api/exports/fuel",
  "/api/exports/inventory",
  "/api/exports/users",
  "/api/exports/vehicles",
  "/api/suppliers/1/invoices/payment",
];

describe.each(MOUNT_HIDDEN)("GET %s : refusé au client par le montage", (path) => {
  it("client 403, corps sans détail technique", async () => {
    for (const actor of ["clientA", "clientNoVehicle"] as const) {
      const res = await get(path, actor);
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    }
  });
});

describe("GET /api/suppliers/:id/invoices/payment : rôles d'approvisionnement", () => {
  it("le magasinier est admis (jamais 401 ni 403), le chef d'atelier et le technicien refusés", async () => {
    const warehouse = await get("/api/suppliers/1/invoices/payment", "warehouse");
    expect([401, 403]).not.toContain(warehouse.status);
    for (const actor of ["manager", "technician", "driver"] as const) {
      const res = await get("/api/suppliers/1/invoices/payment", actor);
      expect(res.status, actor).toBe(403);
    }
  });
});

describe("carburant : ?vehicleId= invalide ou répété", () => {
  it.each(["/api/fuel-records", "/api/fuel-records/consumption-history"])("%s : id hors plage 32 bits en 400", async (path) => {
    for (const actor of ["clientA", "manager"] as const) {
      const res = await get(`${path}?vehicleId=${OUT_OF_RANGE}`, actor);
      expect(apiErrorProblems(res.status, res.body, 400), `${actor} ${path}`).toEqual([]);
    }
  });

  it("?vehicleId=B&vehicleId=A : un client est refusé (403), le premier paramètre fait foi", async () => {
    const res = await get(`/api/fuel-records?vehicleId=${vehicleB}&vehicleId=${vehicleA}`, "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    const history = await get(`/api/fuel-records/consumption-history?vehicleId=${vehicleB}&vehicleId=${vehicleA}`, "clientA");
    expect(apiErrorProblems(history.status, history.body, 403)).toEqual([]);
  });

  it("un client sans véhicule reçoit une liste vide", async () => {
    const res = await get("/api/fuel-records", "clientNoVehicle");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
