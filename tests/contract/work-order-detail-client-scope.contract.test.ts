import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, cloison entre clients sur les sous-ressources d'un ordre de travail.
 *
 * Avant le correctif, GET /api/work-orders/:id/parts, /:id/items et
 * /:id/pending-part-requirements n'exigeaient qu'une session : un client
 * énumérait les ids et lisait prix unitaires et heures des OT d'un autre client.
 * Personnel inchangé ; un client lit toujours les OT de ses véhicules.
 */

type Actor = "manager" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = { manager: "workshop_manager", clientA: "client", clientB: "client" };

const SUBRESOURCES = ["parts", "items", "pending-part-requirements"] as const;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const workOrderIds: number[] = [];
let woA = 0;
let woOrphan = 0;
const MISSING_ID = 2147483000;

async function get(path: string, actor: Actor) {
  const response = await fetch(baseUrl + path, { headers: { Cookie: cookies.get(actor)! } });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
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

  const vehicleA = await createTestVehicle({ ownerId: userIds.get("clientA")! });
  const vehicleB = await createTestVehicle({ ownerId: userIds.get("clientB")! });
  const vehicleOrphan = await createTestVehicle({});
  ids.vehicleIds.push(vehicleA.id, vehicleB.id, vehicleOrphan.id);
  const rows = await db
    .insert(workOrders)
    .values([vehicleA, vehicleB, vehicleOrphan].map((v) => ({ vehicleId: v.id, title: uniqueTestToken("ot-scope"), status: "pending" as const, priority: "medium" as const })))
    .returning();
  workOrderIds.push(...rows.map((r) => r.id));
  woA = rows[0].id;
  woOrphan = rows[2].id;
}, 60000);

afterAll(async () => {
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.each(SUBRESOURCES)("GET /api/work-orders/:id/%s : cloison entre clients", (sub) => {
  const path = (id: number) => `/api/work-orders/${id}/${sub}`;

  it("un client sur l'OT d'un autre client reçoit la même réponse que sur un OT inexistant (404)", async () => {
    const res = await get(path(woA), "clientB");
    expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
    const missing = await get(path(MISSING_ID), "clientB");
    expect(missing.status).toBe(res.status);
    expect(missing.body.message).toBe(res.body.message);
    expect(missing.body.code).toBe(res.body.code);
  });

  it("le propriétaire du véhicule lit son OT", async () => {
    const res = await get(path(woA), "clientA");
    expect(res.status).toBe(200);
    expect(res.body).toBeTypeOf("object");
    expect(res.body).not.toBeNull();
  });

  it("le personnel lit tout", async () => {
    const res = await get(path(woA), "manager");
    expect(res.status).toBe(200);
  });

  it("un id inexistant donne 404", async () => {
    for (const actor of ["manager", "clientA"] as const) {
      const res = await get(path(MISSING_ID), actor);
      expect(apiErrorProblems(res.status, res.body, 404)).toEqual([]);
    }
  });

  it("OT dont le véhicule n'a pas de propriétaire : 404 pour un client, 200 pour le personnel", async () => {
    const refused = await get(path(woOrphan), "clientA");
    expect(apiErrorProblems(refused.status, refused.body, 404)).toEqual([]);
    expect((await get(path(woOrphan), "manager")).status).toBe(200);
  });
});
