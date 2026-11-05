import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, maintenanceSchedules, vehicleAcquisitionWorkflows } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, #292 : deux routes de `server/routes.ts` qui ne passaient que par `authenticate`.
 *
 * - `GET /api/maintenance-schedules/vehicle/:vehicleId` : `isAnyUser` + `canAccessOwned`.
 *   Un client consulte la fiche de son véhicule (planifications comprises), jamais celle
 *   d'un autre client ; le personnel voit tous les véhicules (AGENTS.md §11).
 * - `GET /api/alerts/type/:type` : `isAnyUser`. Les alertes sont nominatives : chacun ne
 *   lit que les siennes, client compris.
 */

type Actor = "admin" | "technician" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = { admin: "admin", technician: "technician", clientA: "client", clientB: "client" };

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const scheduleIds: number[] = [];
const workflowIds: number[] = [];
const workflowSession = (key: string) => `TEST-wf-liste-${key}-${process.pid}`;
const vehicleOf = {} as Record<"A" | "B", number>;

async function get(path: string, actor?: Actor) {
  const response = await fetch(baseUrl + path, { headers: actor ? { Cookie: cookies.get(actor)! } : {} });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // corps non JSON
  }
  return { status: response.status, body, headers: response.headers };
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

  for (const key of ["A", "B"] as const) {
    const ownerId = userIds.get(`client${key}`)!;
    const vehicle = await createTestVehicle({ ownerId });
    ids.vehicleIds.push(vehicle.id);
    vehicleOf[key] = vehicle.id;
    const [schedule] = await db
      .insert(maintenanceSchedules)
      .values({ vehicleId: vehicle.id, title: `TEST vidange ${key}`, frequency: "monthly", frequencyValue: 1 })
      .returning();
    scheduleIds.push(schedule.id);
    const [workflow] = await db.insert(vehicleAcquisitionWorkflows).values({ userId: ownerId, sessionId: workflowSession(key), workflowData: {} }).returning();
    workflowIds.push(workflow.id);
    await db.insert(alerts).values({ userId: ownerId, title: `TEST alerte ${key}`, message: "TEST", type: "maintenance" });
  }
}, 60000);

afterAll(async () => {
  if (workflowIds.length > 0) await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  // Planifications avant les véhicules (clé étrangère) ; les alertes partent avec les utilisateurs.
  if (scheduleIds.length > 0) {
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.id, scheduleIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/maintenance-schedules/vehicle/:vehicleId", () => {
  it("refuse un client sur le véhicule d'un autre client, avec le message de cloison", async () => {
    const res = await get(`/api/maintenance-schedules/vehicle/${vehicleOf.B}`, "clientA");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    expect(res.body.message).toMatch(/n'appartient pas à votre compte/);
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("refuse un client sur un véhicule inexistant (sans révéler lequel existe)", async () => {
    const res = await get("/api/maintenance-schedules/vehicle/2147480000", "clientA");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/n'appartient pas à votre compte/);
  });

  it("laisse un client lire les planifications de son véhicule", async () => {
    const res = await get(`/api/maintenance-schedules/vehicle/${vehicleOf.A}`, "clientA");
    expect(res.status).toBe(200);
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(["TEST vidange A"]);
  });

  it("laisse le personnel lire les planifications de tout véhicule", async () => {
    for (const actor of ["admin", "technician"] as const) {
      const res = await get(`/api/maintenance-schedules/vehicle/${vehicleOf.B}`, actor);
      expect(res.status, actor).toBe(200);
      expect(res.body.map((s: { title: string }) => s.title), actor).toEqual(["TEST vidange B"]);
    }
  });

  it("refuse une requête sans session", async () => {
    expect((await get(`/api/maintenance-schedules/vehicle/${vehicleOf.A}`)).status).toBe(401);
  });
});

describe("GET /api/alerts/type/:type", () => {
  it("ne renvoie à un client que ses propres alertes", async () => {
    const a = await get("/api/alerts/type/maintenance", "clientA");
    expect(a.status).toBe(200);
    expect(a.body.map((x: { title: string }) => x.title)).toEqual(["TEST alerte A"]);
    const b = await get("/api/alerts/type/maintenance", "clientB");
    expect(b.body.map((x: { title: string }) => x.title)).toEqual(["TEST alerte B"]);
  });

  it("ne renvoie au personnel aucune alerte d'un client", async () => {
    const res = await get("/api/alerts/type/maintenance", "admin");
    expect(res.status).toBe(200);
    expect(res.body.some((x: { title: string }) => x.title.startsWith("TEST alerte"))).toBe(false);
  });

  it("refuse une requête sans session", async () => {
    expect((await get("/api/alerts/type/maintenance")).status).toBe(401);
  });
});

describe("listes ouvertes à un client : jamais la liste d'un autre", () => {
  for (const path of ["/api/alerts", "/api/alerts/unread", "/api/alerts/active"]) {
    it(`GET ${path} : chacun ne reçoit que ses alertes`, async () => {
      for (const key of ["A", "B"] as const) {
        const res = await get(path, `client${key}`);
        expect(res.status, path).toBe(200);
        const titles = res.body.map((x: { title: string }) => x.title).filter((t: string) => t.startsWith("TEST alerte"));
        expect(titles, path).toEqual([`TEST alerte ${key}`]);
      }
    });
  }

  for (const path of ["/api/users", "/api/technician/my-work-orders", "/api/document-renewals/requests", "/api/document-renewals/centers"]) {
    it(`GET ${path} : refusé à un client (403), sans liste`, async () => {
      const res = await get(path, "clientA");
      expect(res.status, path).toBe(403);
      expect(Array.isArray(res.body), path).toBe(false);
    });
  }

  it("GET /api/workflows/active et /stats : la session de A, jamais celle de B", async () => {
    for (const [mine, other] of [["A", "B"], ["B", "A"]] as const) {
      const active = await get("/api/workflows/active", `client${mine}`);
      expect(active.status).toBe(200);
      expect(active.body.map((w: { sessionId: string }) => w.sessionId)).toEqual([workflowSession(mine)]);
      expect(JSON.stringify(active.body)).not.toContain(workflowSession(other));
      const stats = await get("/api/workflows/stats", `client${mine}`);
      expect(stats.status).toBe(200);
      expect(stats.body.total).toBe(1);
    }
  });
});
