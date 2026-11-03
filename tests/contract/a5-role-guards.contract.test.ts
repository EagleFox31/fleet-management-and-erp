import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts, partsStockMovements, workOrders } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, lot A5 (3 novembre 2026) : gardes de rôle sur des routes que la cloison A4 n'avait pas vues.
 *
 * - POST /api/warehouse/stock-movement : écriture de stock, magasin seul (admin, warehouse).
 *   Avant : tout le personnel (chauffeur, technicien, secrétaire) écrivait un mouvement ; la
 *   réponse 500 renvoyait error.message.
 * - GET /api/dashboard/technician-stats : un client lisait toute la flotte. Rôles atelier.
 * - GET /api/users/technicians, GET /api/labor-catalog : un client lisait le personnel et le barème.
 * - GET /api/vehicles/:id/tires : id hors plage 32 bits : 400, pas 500.
 * - GET /api/work-orders/:id : cloison par assertWorkOrderReadable, règle du technicien conservée.
 * - PATCH /api/technician/work-orders/:id/status : seul un technicien (garde de non-régression).
 */

type Actor = "admin" | "warehouse" | "manager" | "technician" | "technician2" | "driver" | "secretary" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = {
  admin: "admin",
  warehouse: "warehouse",
  manager: "workshop_manager",
  technician: "technician",
  technician2: "technician",
  driver: "driver",
  secretary: "secretary",
  clientA: "client",
  clientB: "client",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const workOrderIds: number[] = [];
let partId = 0;
let vehicleA = 0;
let vehicleB = 0;
let woOwnTech = 0;
let woOtherTech = 0;
let woUnassigned = 0;
let woB = 0;
const OUT_OF_RANGE = "99999999999";
const MISSING_ID = 2147483000;

async function call(method: string, path: string, actor: Actor, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookies.get(actor)!, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // corps non JSON : conservé tel quel
  }
  return { status: response.status, body: parsed };
}

const movement = (overrides: Record<string, unknown> = {}) => ({
  partId,
  type: "in",
  quantity: 1,
  reason: "TEST A5 mouvement",
  ...overrides,
});

async function quantityOfPart() {
  const [row] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, partId));
  return row.quantity;
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

  const part = await createTestPart({ quantity: 10 });
  ids.partIds.push(part.id);
  partId = part.id;

  const a = await createTestVehicle({ ownerId: userIds.get("clientA")! });
  const b = await createTestVehicle({ ownerId: userIds.get("clientB")! });
  ids.vehicleIds.push(a.id, b.id);
  vehicleA = a.id;
  vehicleB = b.id;

  const rows = await db
    .insert(workOrders)
    .values([
      { vehicleId: a.id, technicianId: userIds.get("technician")!, title: uniqueTestToken("ot-a5"), status: "pending" as const, priority: "medium" as const },
      { vehicleId: a.id, technicianId: userIds.get("technician2")!, title: uniqueTestToken("ot-a5"), status: "pending" as const, priority: "medium" as const },
      { vehicleId: a.id, title: uniqueTestToken("ot-a5"), status: "pending" as const, priority: "medium" as const },
      { vehicleId: b.id, title: uniqueTestToken("ot-a5"), status: "pending" as const, priority: "medium" as const },
    ])
    .returning();
  workOrderIds.push(...rows.map((r) => r.id));
  [woOwnTech, woOtherTech, woUnassigned, woB] = rows.map((r) => r.id);
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  if (partId) await db.delete(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("A5-1 POST /api/warehouse/stock-movement : écriture de stock réservée au magasin", { timeout: 60000 }, () => {
  it.each(["driver", "technician", "secretary", "manager", "clientA"] as const)("%s est refusé (403) et le stock ne bouge pas", async (actor) => {
    const before = await quantityOfPart();
    const res = await call("POST", "/api/warehouse/stock-movement", actor, movement());
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    expect(await quantityOfPart()).toBe(before);
  });

  it("le magasinier enregistre une entrée (201) puis une sortie (201), stock à jour", async () => {
    const before = await quantityOfPart();
    const entry = await call("POST", "/api/warehouse/stock-movement", "warehouse", movement({ quantity: 3 }));
    expect(entry.status).toBe(201);
    expect(await quantityOfPart()).toBe(before + 3);
    const exit = await call("POST", "/api/warehouse/stock-movement", "warehouse", movement({ type: "out", quantity: 2 }));
    expect(exit.status).toBe(201);
    expect(await quantityOfPart()).toBe(before + 1);
  });

  it("l'administrateur enregistre un mouvement (201)", async () => {
    const res = await call("POST", "/api/warehouse/stock-movement", "admin", movement());
    expect(res.status).toBe(201);
  });

  it.each([
    ["partId non numérique", { partId: "abc" }],
    ["partId hors entier 32 bits", { partId: OUT_OF_RANGE }],
    ["partId négatif", { partId: -4 }],
    ["quantité nulle", { quantity: 0 }],
    ["quantité négative", { quantity: -5 }],
    ["quantité non numérique", { quantity: "beaucoup" }],
    ["quantité infinie", { quantity: "1e999" }],
    ["quantité décimale", { quantity: 1.5 }],
    ["workOrderId hors plage", { workOrderId: OUT_OF_RANGE }],
    ["type inconnu", { type: "swap" }],
  ] as const)("donnée invalide (%s) : 400 lisible, stock inchangé", async (_label, override) => {
    const before = await quantityOfPart();
    const res = await call("POST", "/api/warehouse/stock-movement", "warehouse", movement(override));
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    expect(await quantityOfPart()).toBe(before);
  });

  it("ordre de travail inexistant : 404 lisible, stock inchangé", async () => {
    const before = await quantityOfPart();
    const res = await call("POST", "/api/warehouse/stock-movement", "warehouse", movement({ workOrderId: MISSING_ID }));
    expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
    expect(await quantityOfPart()).toBe(before);
  });

  it("pièce inconnue : 404 lisible, sans détail technique", async () => {
    const res = await call("POST", "/api/warehouse/stock-movement", "warehouse", movement({ partId: MISSING_ID }));
    expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
  });
});

describe("A5-2 GET /api/dashboard/technician-stats", { timeout: 60000 }, () => {
  it.each(["clientA", "driver", "secretary"] as const)("%s est refusé (403)", async (actor) => {
    const res = await call("GET", "/api/dashboard/technician-stats", actor);
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it.each(["technician", "manager", "admin"] as const)("%s lit ses statistiques (200)", async (actor) => {
    const res = await call("GET", "/api/dashboard/technician-stats", actor);
    expect(res.status).toBe(200);
  });
});

describe("A5-3 GET /api/users/technicians", { timeout: 60000 }, () => {
  it("un client est refusé (403), aucun nom de personnel ne sort", async () => {
    const res = await call("GET", "/api/users/technicians", "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it.each(["technician", "manager", "admin", "secretary"] as const)("%s lit la liste (200)", async (actor) => {
    const res = await call("GET", "/api/users/technicians", actor);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("A5-4 GET /api/labor-catalog", { timeout: 60000 }, () => {
  it("un client est refusé (403)", async () => {
    const res = await call("GET", "/api/labor-catalog", "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it.each(["technician", "manager", "admin"] as const)("%s lit le barème (200)", async (actor) => {
    const res = await call("GET", "/api/labor-catalog", actor);
    expect(res.status).toBe(200);
  });
});

describe("A5-5 GET /api/vehicles/:id/tires : identifiant", { timeout: 60000 }, () => {
  it.each(["manager", "clientA"] as const)("%s : id hors plage 32 bits donne 400 lisible, pas 500", async (actor) => {
    const res = await call("GET", `/api/vehicles/${OUT_OF_RANGE}/tires`, actor);
    expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
  });

  it("le propriétaire lit les pneus de son véhicule, pas ceux d'un autre client", async () => {
    expect((await call("GET", `/api/vehicles/${vehicleA}/tires`, "clientA")).status).toBe(200);
    const other = await call("GET", `/api/vehicles/${vehicleB}/tires`, "clientA");
    expect(apiErrorProblems(other.status, other.body, 403)).toEqual([]);
  });
});

describe("A5-6 GET /api/work-orders/:id", { timeout: 60000 }, () => {
  it("client d'un autre véhicule : 403 au contrat d'erreur", async () => {
    const res = await call("GET", `/api/work-orders/${woB}`, "clientA");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it("le propriétaire et le personnel lisent l'OT (200)", async () => {
    expect((await call("GET", `/api/work-orders/${woUnassigned}`, "clientA")).status).toBe(200);
    expect((await call("GET", `/api/work-orders/${woUnassigned}`, "manager")).status).toBe(200);
  });

  it("le technicien lit son OT et un OT non affecté, pas celui d'un autre technicien", async () => {
    expect((await call("GET", `/api/work-orders/${woOwnTech}`, "technician")).status).toBe(200);
    expect((await call("GET", `/api/work-orders/${woUnassigned}`, "technician")).status).toBe(200);
    const refused = await call("GET", `/api/work-orders/${woOtherTech}`, "technician");
    expect(apiErrorProblems(refused.status, refused.body, 403)).toEqual([]);
  });

  it("OT inconnu : 404 ; identifiant invalide ou hors plage : 400, au contrat d'erreur", async () => {
    const missing = await call("GET", `/api/work-orders/${MISSING_ID}`, "manager");
    expect(apiErrorProblems(missing.status, missing.body, 404)).toEqual([]);
    for (const bad of ["abc", "0", OUT_OF_RANGE]) {
      const res = await call("GET", `/api/work-orders/${bad}`, "manager");
      expect(apiErrorProblems(res.status, res.body, 400)).toEqual([]);
    }
  });
});

describe("A5-7 PATCH /api/technician/work-orders/:id/status : non-régression", { timeout: 60000 }, () => {
  it.each(["secretary", "driver", "clientA", "manager"] as const)("%s est refusé (403)", async (actor) => {
    const res = await call("PATCH", `/api/technician/work-orders/${woOwnTech}/status`, actor, { status: "in_progress" });
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });
});

describe("A5-8 GET /api/vehicles et /all : cloison servie par le routeur", { timeout: 60000 }, () => {
  it.each(["/api/vehicles?limit=1000", "/api/vehicles/all"] as const)("un client ne voit que ses véhicules sur %s", async (path) => {
    const res = await call("GET", path, "clientA");
    expect(res.status).toBe(200);
    const list = (Array.isArray(res.body) ? res.body : (res.body as { vehicles: { id: number }[] }).vehicles).map((v: { id: number }) => v.id);
    expect(list).toContain(vehicleA);
    expect(list).not.toContain(vehicleB);
  });
});
