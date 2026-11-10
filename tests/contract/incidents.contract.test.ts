import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, incidents, missions } from "../../shared/schema";
import { incidentsResponseSchema, incidentSchema } from "../../shared/contracts/incidents";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { TEST_PREFIX } from "../support/ids";

/** Déclaration de panne (T-43): 401, 403 client, chauffeur limité à son véhicule affecté, personnel libre. */

const previousFlags = process.env.FEATURE_FLAGS;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const driverIds: number[] = [];
const missionIds: number[] = [];

async function call(method: string, cookie: string | null, body?: unknown, path = "/api/incidents") {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function login(username: string): Promise<string> {
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  if (ids.vehicleIds.length > 0) await db.delete(incidents).where(inArray(incidents.vehicleId, ids.vehicleIds));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("déclaration de panne", { timeout: 180000 }, () => {
  it("applique le périmètre par rôle", async () => {
    // Drapeau coupé explicitement: la route n'existe pas. Sans surcharge, il est actif par défaut.
    process.env.FEATURE_FLAGS = "incidents=off";
    expect((await call("GET", null)).status).toBe(404);
    delete process.env.FEATURE_FLAGS;
    expect((await call("GET", null)).status).toBe(401);

    const driverUser = await createTestUser({ role: "driver" });
    const manager = await createTestUser({ role: "workshop_manager" });
    const client = await createTestUser({ role: "client" });
    ids.userIds.push(driverUser.id, manager.id, client.id);
    const own = await createTestVehicle();
    const other = await createTestVehicle();
    ids.vehicleIds.push(own.id, other.id);

    const [driver] = await db
      .insert(drivers)
      .values({ userId: driverUser.id, firstName: "Test", lastName: TEST_PREFIX })
      .returning();
    driverIds.push(driver.id);
    const [mission] = await db
      .insert(missions)
      .values({ orderNumber: `${TEST_PREFIX}-INC-${Date.now()}`, pickupAddress: "A", deliveryAddress: "B" })
      .returning();
    missionIds.push(mission.id);
    await db.insert(assignments).values({ missionId: mission.id, vehicleId: own.id, driverId: driver.id, status: "accepted" });

    const [driverCookie, managerCookie, clientCookie] = await Promise.all(
      [driverUser, manager, client].map((u) => login(u.username)),
    );
    const payload = (vehicleId: number) => ({ vehicleId, description: "Voyant moteur allumé", severity: "high" });

    expect((await call("POST", null, payload(own.id))).status).toBe(401);
    expect((await call("GET", null)).status).toBe(401);
    expect((await call("POST", clientCookie, payload(own.id))).status).toBe(403);
    expect((await call("GET", clientCookie)).status).toBe(403);

    // Corps invalide: 400.
    expect((await call("POST", managerCookie, { vehicleId: own.id, description: "x", severity: "high" })).status).toBe(400);

    // Chauffeur: son véhicule oui, un autre non.
    const created = await call("POST", driverCookie, payload(own.id));
    expect(created.status).toBe(201);
    expect(incidentSchema.safeParse(created.body).success).toBe(true);
    expect(created.body.status).toBe("open");
    expect(created.body.vehicleRegistration).toBe(own.registrationNumber);
    expect((await call("POST", driverCookie, payload(other.id))).status).toBe(403);

    // Personnel: n'importe quel véhicule.
    expect((await call("POST", managerCookie, payload(other.id))).status).toBe(201);

    // Listes: le chauffeur ne voit que les siennes, le personnel voit tout, filtre par statut.
    const mine = await call("GET", driverCookie);
    expect(mine.status).toBe(200);
    expect(incidentsResponseSchema.safeParse(mine.body).success).toBe(true);
    expect(mine.body.every((i: { reportedBy: number }) => i.reportedBy === driverUser.id)).toBe(true);
    expect(mine.body.some((i: { id: number }) => i.id === created.body.id)).toBe(true);
    expect(mine.body.find((i: { id: number }) => i.id === created.body.id).vehicleRegistration).toBe(own.registrationNumber);
    const all = await call("GET", managerCookie, undefined, "/api/incidents?status=open");
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThanOrEqual(2);
    expect((await call("GET", managerCookie, undefined, "/api/incidents?status=bogus")).status).toBe(400);
  });
});
