import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Id hors plage int4 lu dans la query ou le corps : le filet `routeIdRangeGuard` ne lit que le
 * chemin. Sans borne dans le schéma, la valeur atteint la base (erreur 22003) et répond 500.
 * Attendu : 400 au contrat d'erreur, sans requête en base.
 */

// Trois routes sont derrière un drapeau coupé par défaut (404 sinon).
process.env.FEATURE_FLAGS = "time-tracking=on,tire-movements=on,incidents=on";

const OUT_OF_RANGE = 2147483648;

let server: Server;
let baseUrl = "";
let adminCookie = "";
const ids = createIdBag();

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: adminCookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null), requestId: response.headers.get("x-request-id") };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  adminCookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 120000);

const CASES: Array<[string, string, string, unknown?]> = [
  ["query userId", "GET", `/api/audit-logs?userId=${OUT_OF_RANGE}`],
  ["query userId", "GET", `/api/time-tracking?userId=${OUT_OF_RANGE}&month=1&year=2026`],
  ["query vehicleId", "GET", `/api/tires/movements?vehicleId=${OUT_OF_RANGE}`],
  ["query tireId", "GET", `/api/tires/movements?tireId=${OUT_OF_RANGE}`],
  ["corps vehicleId", "POST", "/api/incidents", { vehicleId: OUT_OF_RANGE, description: "Test hors plage", severity: "low" }],
  [
    "corps vehicleId",
    "POST",
    "/api/maintenance-schedules",
    { vehicleId: OUT_OF_RANGE, title: "Test", frequency: "monthly", frequencyValue: 1, scheduledDate: "2026-12-01" },
  ],
  ["corps vehicleId", "POST", "/api/document-renewals/requests", { vehicleId: OUT_OF_RANGE, vehicleDocumentId: 1, comment: "Test hors plage" }],
  ["corps fuelRecordId", "POST", "/api/operations/missions/from-fuel", { fuelRecordId: OUT_OF_RANGE, clientName: "Test" }],
  ["corps userId", "POST", "/api/drivers", { firstName: "Test", lastName: "Hors plage", userId: OUT_OF_RANGE }],
  [
    "corps vehicleId",
    "POST",
    "/api/missions/1/fuel-records",
    { vehicleId: OUT_OF_RANGE, quantity: 10, unitPrice: 800, requestKey: "test-hors-plage-0001" },
  ],
  [
    "corps supplierId",
    "POST",
    "/api/purchase-orders",
    { supplierId: OUT_OF_RANGE, manualLines: [{ description: "Test", quantityOrdered: 1, unitPrice: 1000 }] },
  ],
  ["corps requirementIds", "POST", "/api/purchase-orders", { supplierId: 1, requirementIds: [OUT_OF_RANGE] }],
  ["corps vehicleId", "POST", "/api/missions/1/assignments", { vehicleId: OUT_OF_RANGE, driverId: 1 }],
  [
    "corps vehicleId",
    "POST",
    "/api/fuel-card/consumption",
    { vehicleId: OUT_OF_RANGE, quantity: 10, unitPrice: 800, date: "2026-11-05", stationName: "Test", destination: "Test" },
  ],
  ["corps missionId", "POST", "/api/billing/invoices/generate", { missionId: OUT_OF_RANGE, amount: 1000, dueDate: "2026-12-01" }],
];

describe("id hors plage int4 dans la query ou le corps -> 400", { timeout: 60000 }, () => {
  it.each(CASES)("%s : %s %s", async (_label, method, path, body) => {
    const res = await call(method, path, body);
    expect(res.status).toBe(400);
    expect(typeof res.body?.message).toBe("string");
    expect(res.body?.requestId).toBe(res.requestId);
    // Le refus porte sur l'id, pas sur un autre champ du corps (sinon faux vert).
    const fields = (res.body?.errors ?? []).map((error: { field?: string }) => error.field);
    expect(fields.some((field: string | undefined) => /Ids?(\.\d+)?$/.test(field ?? ""))).toBe(true);
  });
});
