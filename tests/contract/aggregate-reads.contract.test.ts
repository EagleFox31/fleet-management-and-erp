import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pendingInvoicesResponseSchema, PENDING_INVOICES_PATH } from "../../shared/contracts/pending-invoices";
import { tireMovementsResponseSchema, TIRE_MOVEMENTS_PATH } from "../../shared/contracts/tire-movements";
import { vehicleCostSummaryPath, vehicleCostSummaryResponseSchema } from "../../shared/contracts/vehicle-cost-summary";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-40 : lectures agregees (cout vehicule, mouvements de pneus, factures en attente). */
process.env.FEATURE_FLAGS = "vehicle-cost-summary=on,tire-movements=on,pending-invoices=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
let vehicleId = 0;

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
async function get(path: string, role?: string) {
  const res = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "management", "technician", "client", "secretary"] as const) await login(role);
  const v = await createTestVehicle();
  vehicleId = v.id;
  ids.vehicleIds.push(v.id);
}, 180000);
afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("lectures agregees", { timeout: 120000 }, () => {
  it("cout vehicule : roles, contrat, 404 et 400", async () => {
    const path = vehicleCostSummaryPath(vehicleId);
    expect((await get(path)).status).toBe(401);
    expect((await get(path, "technician")).status).toBe(403);
    expect((await get(path, "client")).status).toBe(403);
    const ok = await get(path, "management");
    expect(ok.status).toBe(200);
    expect(vehicleCostSummaryResponseSchema.safeParse(ok.body).success).toBe(true);
    expect(ok.body).toMatchObject({ vehicleId, total: 0, workOrderCount: 0 });
    expect((await get(vehicleCostSummaryPath(99999999), "admin")).status).toBe(404);
    expect((await get(vehicleCostSummaryPath(0), "admin")).status).toBe(400);
    expect((await get(path + "?from=2021-02-01&to=2021-01-01", "admin")).status).toBe(400);
  });

  it("mouvements de pneus : roles, contrat, filtre invalide", async () => {
    expect((await get(TIRE_MOVEMENTS_PATH)).status).toBe(401);
    expect((await get(TIRE_MOVEMENTS_PATH, "client")).status).toBe(403);
    const ok = await get(`${TIRE_MOVEMENTS_PATH}?vehicleId=${vehicleId}`, "technician");
    expect(ok.status).toBe(200);
    expect(tireMovementsResponseSchema.safeParse(ok.body).success).toBe(true);
    expect((await get(`${TIRE_MOVEMENTS_PATH}?tireId=abc`, "admin")).status).toBe(400);
  });

  it("factures en attente : roles et contrat", async () => {
    expect((await get(PENDING_INVOICES_PATH)).status).toBe(401);
    expect((await get(PENDING_INVOICES_PATH, "technician")).status).toBe(403);
    expect((await get(PENDING_INVOICES_PATH, "client")).status).toBe(403);
    for (const role of ["secretary", "management", "admin"]) {
      const ok = await get(PENDING_INVOICES_PATH, role);
      expect(ok.status).toBe(200);
      expect(pendingInvoicesResponseSchema.safeParse(ok.body).success).toBe(true);
    }
  });

  it("drapeau coupe : 404 normalise", async () => {
    process.env.FEATURE_FLAGS = "pending-invoices=off";
    try {
      const off = await get(PENDING_INVOICES_PATH, "admin");
      expect(off.status).toBe(404);
      expect(off.body).toMatchObject({ code: "NOT_FOUND" });
    } finally {
      process.env.FEATURE_FLAGS = "vehicle-cost-summary=on,tire-movements=on,pending-invoices=on";
    }
  });
});
