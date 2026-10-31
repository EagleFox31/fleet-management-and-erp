import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fuelAnomalyPath, fuelAnomalyResolutionSchema } from "../../shared/contracts/fuel-anomalies";
import { fuelAnomalyResolutions } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-42 : traitement des anomalies carburant et evenement temps reel. */
process.env.FEATURE_FLAGS = "fuel-anomalies=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const keys: string[] = [];
const events: { event: string; data: any }[] = [];
let key = "";

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}
async function patch(path: string, body: unknown, role?: string) {
  const res = await fetch(baseUrl + path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  (global as any).broadcastUpdate = (event: string, data: unknown) => events.push({ event, data });
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["logistics", "technician", "client"] as const) await login(role);
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const fr = await createTestFuelRecord({ vehicleId: v.id });
  ids.fuelRecordIds.push(fr.id);
  key = `consumption-gap:${fr.id}`;
  keys.push(key);
}, 180000);
afterAll(async () => {
  if (keys.length) await db.delete(fuelAnomalyResolutions).where(inArray(fuelAnomalyResolutions.anomalyKey, keys));
  await cleanupCreated(ids);
  delete (global as any).broadcastUpdate;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("PATCH /api/fuel-card/anomalies/:id", { timeout: 120000 }, () => {
  it("refuse sans session, technicien et client", async () => {
    expect((await patch(fuelAnomalyPath(key), { status: "justified" })).status).toBe(401);
    expect((await patch(fuelAnomalyPath(key), { status: "justified" }, "technician")).status).toBe(403);
    expect((await patch(fuelAnomalyPath(key), { status: "justified" }, "client")).status).toBe(403);
  });

  it("traite l'anomalie, emet fuel_anomaly_resolved, et accepte le changement d'avis", async () => {
    const first = await patch(fuelAnomalyPath(key), { status: "justified", comment: "Plein de reserve" }, "logistics");
    expect(first.status).toBe(200);
    expect(fuelAnomalyResolutionSchema.safeParse(first.body).success).toBe(true);
    expect(first.body).toMatchObject({ anomalyKey: key, status: "justified", comment: "Plein de reserve" });
    const evt = events.find((e) => e.event === "fuel_anomaly_resolved");
    expect(evt?.data).toMatchObject({ anomalyKey: key, scope: { type: "roles" } });

    const again = await patch(fuelAnomalyPath(key), { status: "confirmed" }, "logistics");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "confirmed", comment: null });
  });

  it("refuse une cle invalide (400), un statut inconnu (400) et un plein absent (404)", async () => {
    expect((await patch(fuelAnomalyPath("n'importe quoi"), { status: "open" }, "logistics")).status).toBe(400);
    expect((await patch(fuelAnomalyPath(key), { status: "resolu" }, "logistics")).status).toBe(400);
    expect((await patch(fuelAnomalyPath("consumption-gap:999999999"), { status: "open" }, "logistics")).status).toBe(404);
  });

  it("drapeau coupe : 404 normalise", async () => {
    process.env.FEATURE_FLAGS = "fuel-anomalies=off";
    try {
      const off = await patch(fuelAnomalyPath(key), { status: "open" }, "logistics");
      expect(off.status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "fuel-anomalies=on";
    }
  });
});
