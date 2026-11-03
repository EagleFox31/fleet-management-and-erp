import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, lectures encore ouvertes à tout compte connecté (suite de #127 et #157).
 *
 * Carburant : GET /api/fuel-records (liste et ?vehicleId=), /statistics et
 * /consumption-history sont ouverts au client, cloisonnés sur ses véhicules
 * (l'écran client lit /statistics). /api/statistics/fleet alimente /vehicles, ouvert
 * au client : décompte limité à ses véhicules.
 * Données internes (stock, prix, factures fournisseur, KPI) : personnel seul.
 * GET /api/work-orders/:id : id hors plage 32 bits en 400, non en 500.
 */

type Actor = "manager" | "driver" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = {
  manager: "workshop_manager",
  driver: "driver",
  clientA: "client",
  clientB: "client",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
let vehicleA = 0;
let vehicleB = 0;
const recordIds: number[] = [];
const QUANTITY_A = 41.5;
const QUANTITY_B = 73.25;

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
  const rows = await db
    .insert(fuelRecords)
    .values([
      { vehicleId: a.id, date: today, quantity: QUANTITY_A, cost: "50000", mileage: 1000 },
      { vehicleId: b.id, date: today, quantity: QUANTITY_B, cost: "90000", mileage: 2000 },
    ])
    .returning();
  recordIds.push(...rows.map((r) => r.id));
}, 60000);

afterAll(async () => {
  if (recordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, recordIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const vehicleIdsOf = (body: unknown): number[] => (Array.isArray(body) ? body.map((r: { vehicleId: number }) => r.vehicleId) : []);

describe("GET /api/fuel-records : cloison entre clients", () => {
  it("un client lit ses pleins par ?vehicleId=", async () => {
    const res = await get(`/api/fuel-records?vehicleId=${vehicleA}`, "clientA");
    expect(res.status).toBe(200);
    expect(vehicleIdsOf(res.body)).toEqual([vehicleA]);
  });

  it("un client est refusé sur ?vehicleId= d'un autre client (403, corps sans détail technique)", async () => {
    const res = await get(`/api/fuel-records?vehicleId=${vehicleB}`, "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it("la liste sans paramètre d'un client ne contient que ses véhicules", async () => {
    const res = await get("/api/fuel-records", "clientA");
    expect(res.status).toBe(200);
    expect(vehicleIdsOf(res.body)).toEqual([vehicleA]);
    const resB = await get("/api/fuel-records", "clientB");
    expect(vehicleIdsOf(resB.body)).toEqual([vehicleB]);
  });

  it("le personnel lit tout, par véhicule comme en liste", async () => {
    for (const actor of ["manager", "driver"] as const) {
      const one = await get(`/api/fuel-records?vehicleId=${vehicleB}`, actor);
      expect(one.status).toBe(200);
      expect(vehicleIdsOf(one.body)).toEqual([vehicleB]);
      const all = await get("/api/fuel-records", actor);
      expect(all.status).toBe(200);
      expect(vehicleIdsOf(all.body)).toEqual(expect.arrayContaining([vehicleA, vehicleB]));
    }
  });
});

describe("GET /api/fuel-records/statistics : agrégat limité aux véhicules du client", () => {
  it("un client ne voit que son véhicule et ses litres", async () => {
    const res = await get("/api/fuel-records/statistics?period=month", "clientA");
    expect(res.status).toBe(200);
    const body = res.body as { totalFuel: number; vehicleStats: Array<{ vehicleId: number }> };
    expect(body.vehicleStats.map((v) => v.vehicleId)).toEqual([vehicleA]);
    expect(body.totalFuel).toBeCloseTo(QUANTITY_A, 5);
  });

  it("le personnel voit les deux véhicules", async () => {
    const res = await get("/api/fuel-records/statistics?period=month", "manager");
    expect(res.status).toBe(200);
    const body = res.body as { vehicleStats: Array<{ vehicleId: number }> };
    expect(body.vehicleStats.map((v) => v.vehicleId)).toEqual(expect.arrayContaining([vehicleA, vehicleB]));
  });
});

describe("GET /api/fuel-records/consumption-history : cloison entre clients", () => {
  const sum = (body: unknown) => (body as Array<{ quantity: number }>).reduce((acc, row) => acc + row.quantity, 0);

  it("un client est refusé sur le véhicule d'un autre (403)", async () => {
    const res = await get(`/api/fuel-records/consumption-history?period=month&vehicleId=${vehicleB}`, "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it("sans véhicule, un client n'agrège que les siens", async () => {
    const res = await get("/api/fuel-records/consumption-history?period=month", "clientA");
    expect(res.status).toBe(200);
    expect(sum(res.body)).toBeCloseTo(QUANTITY_A, 5);
  });

  it("le personnel lit l'historique d'un véhicule", async () => {
    const res = await get(`/api/fuel-records/consumption-history?period=month&vehicleId=${vehicleB}`, "manager");
    expect(res.status).toBe(200);
    expect(sum(res.body)).toBeCloseTo(QUANTITY_B, 5);
  });
});

describe("GET /api/statistics/fleet : décompte limité aux véhicules du client", () => {
  it("un client compte ses propres véhicules, pas la flotte", async () => {
    const res = await get("/api/statistics/fleet", "clientA");
    expect(res.status).toBe(200);
    const body = res.body as { operational: number; maintenance: number; outOfService: number };
    expect(body.operational + body.maintenance + body.outOfService).toBe(1);
  });

  it("le personnel lit le décompte de la flotte", async () => {
    const res = await get("/api/statistics/fleet", "manager");
    expect(res.status).toBe(200);
    const body = res.body as { operational: number; maintenance: number; outOfService: number };
    expect(body.operational + body.maintenance + body.outOfService).toBeGreaterThanOrEqual(2);
  });
});

const STAFF_ONLY: Array<[string, string]> = [
  ["/api/parts-used", "/api/parts-used"],
  ["/api/invoices/by-family", "/api/invoices/by-family"],
  ["/api/invoices/monthly-vat-stats", "/api/invoices/monthly-vat-stats"],
  ["/api/parts", "/api/parts"],
  ["/api/parts/statistics", "/api/parts/statistics"],
  ["/api/parts/low-on-stock", "/api/parts/low-on-stock"],
  ["/api/parts/stock-movements", "/api/parts/stock-movements"],
  ["/api/statistics/fleet-kpi", "/api/statistics/fleet-kpi"],
  ["/api/statistics/fleet-history", "/api/statistics/fleet-history"],
  ["/api/statistics/scheduled-maintenance", "/api/statistics/scheduled-maintenance"],
];

describe.each(STAFF_ONLY)("GET %s : donnée interne réservée au personnel", (_label, path) => {
  it("un client est refusé (403, corps sans détail technique)", async () => {
    for (const actor of ["clientA", "clientB"] as const) {
      const res = await get(path, actor);
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    }
  });

  it("le personnel lit (atelier, chauffeur)", async () => {
    for (const actor of ["manager", "driver"] as const) {
      expect((await get(path, actor)).status).toBe(200);
    }
  });
});

describe("routes à identifiant : refus du client avant toute lecture", () => {
  it.each(["/api/parts/999999999/stock-history", "/api/parts/999999999/real-stock", "/api/invoices/999999999/parts"])(
    "GET %s : 403 pour un client",
    async (path) => {
      const res = await get(path, "clientA");
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    },
  );
});

describe("GET /api/parts/:id/* : id hors plage", () => {
  it.each(["/api/parts/99999999999", "/api/parts/99999999999/stock-history", "/api/parts/99999999999/work-orders", "/api/parts/99999999999/usage-history", "/api/parts/99999999999/real-stock"])(
    "GET %s : 400 pour le personnel (et non 500)",
    async (path) => {
      const res = await get(path, "manager");
      expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    },
  );
});

describe("GET /api/work-orders/:id : id hors plage", () => {
  it("un id hors entier 32 bits répond 400 (et non 500)", async () => {
    for (const actor of ["manager", "clientA"] as const) {
      const res = await get("/api/work-orders/99999999999", actor);
      expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    }
  });
});
