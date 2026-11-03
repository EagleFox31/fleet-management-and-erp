import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, lectures d'OT de flotte réservées au personnel (suite de la cloison #157).
 *
 * Avant le correctif, ces GET n'exigeaient qu'une session : un client lisait les
 * rotations de pneus de n'importe quel OT, la file « en attente de pièces »
 * (100 OT de la flotte avec véhicules), l'export XLSX de tous les OT, l'historique
 * d'usage d'une pièce et les statistiques d'atelier. Personnel inchangé ; le client
 * garde les rotations de pneus de l'OT de son véhicule.
 */

type Actor = "manager" | "technician" | "driver" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = {
  manager: "workshop_manager",
  technician: "technician",
  driver: "driver",
  clientA: "client",
  clientB: "client",
};

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const workOrderIds: number[] = [];
let woA = 0;
let partId = 0;
const MISSING_ID = 2147483000;

async function get(path: string, actor: Actor) {
  const response = await fetch(baseUrl + path, { headers: { Cookie: cookies.get(actor)! } });
  const buffer = Buffer.from(await response.arrayBuffer());
  let body: unknown = buffer.toString("utf8");
  try {
    body = JSON.parse(body as string);
  } catch {
    // corps non JSON (export XLSX) : conservé tel quel
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

  const vehicleA = await createTestVehicle({ ownerId: userIds.get("clientA")! });
  const vehicleB = await createTestVehicle({ ownerId: userIds.get("clientB")! });
  ids.vehicleIds.push(vehicleA.id, vehicleB.id);
  const rows = await db
    .insert(workOrders)
    .values([vehicleA, vehicleB].map((v) => ({ vehicleId: v.id, title: uniqueTestToken("ot-reads"), status: "awaiting_parts" as const, priority: "medium" as const })))
    .returning();
  workOrderIds.push(...rows.map((r) => r.id));
  woA = rows[0].id;
  const part = await createTestPart({});
  ids.partIds.push(part.id);
  partId = part.id;
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("GET /api/work-orders/:workOrderId/tire-rotations : cloison entre clients", () => {
  const path = (id: number | string) => `/api/work-orders/${id}/tire-rotations`;

  it("un client est refusé sur l'OT d'un autre client (403, corps sans détail technique)", async () => {
    const res = await get(path(woA), "clientB");
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
  });

  it("le propriétaire du véhicule lit les rotations de son OT", async () => {
    const res = await get(path(woA), "clientA");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("le personnel lit tout", async () => {
    for (const actor of ["manager", "technician"] as const) {
      expect((await get(path(woA), actor)).status).toBe(200);
    }
  });

  it("OT inexistant : 404 ; id hors plage 32 bits : 400 (et non 500)", async () => {
    const missing = await get(path(MISSING_ID), "manager");
    expect(apiErrorProblems(missing.status, missing.body, 404)).toEqual([]);
    const tooBig = await get(path("3000000000"), "manager");
    expect(apiErrorProblems(tooBig.status, tooBig.body, 400)).toEqual([]);
  });
});

const STAFF_ONLY: Array<[string, () => string]> = [
  ["/api/work-orders/awaiting-parts", () => "/api/work-orders/awaiting-parts"],
  ["/api/work-orders/statistics", () => "/api/work-orders/statistics"],
  ["/api/statistics/work-orders", () => "/api/statistics/work-orders"],
  ["/api/parts/:id/work-orders", () => `/api/parts/${partId}/work-orders`],
  ["/api/parts/:id/usage-history", () => `/api/parts/${partId}/usage-history`],
];

describe.each(STAFF_ONLY)("GET %s : lecture de flotte réservée au personnel", (_label, path) => {
  it("un client est refusé (403, corps sans détail technique)", async () => {
    for (const actor of ["clientA", "clientB"] as const) {
      const res = await get(path(), actor);
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    }
  });

  it("le personnel lit (atelier, technicien, chauffeur)", async () => {
    for (const actor of ["manager", "technician", "driver"] as const) {
      expect((await get(path(), actor)).status).toBe(200);
    }
  });
});

describe("GET /api/exports/work-orders : matrice d'export déjà montée avant le handler", () => {
  // Le routeur /api/exports est gardé par EXPORT_ROLE_MATRIX (shared/contracts/exports.ts) : le
  // handler de routes.ts n'est jamais atteint hors de ces rôles. `isStaff` y double la garde.
  it("un client est refusé, l'atelier lit l'export", async () => {
    for (const actor of ["clientA", "clientB"] as const) {
      const res = await get("/api/exports/work-orders", actor);
      expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    }
    expect((await get("/api/exports/work-orders", "manager")).status).toBe(200);
  });
});
