import { createServer, type Server } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../../server/lib/app-error";
import { storage } from "../../server/storage";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Deux lectures « argent / stock » : une erreur interne passe par le gestionnaire central
 * (`{ message, code, requestId }`), sans détail technique.
 * - GET /api/parts/stock-movements : personnel uniquement.
 * - GET /api/statistics/maintenance-cost/:period : admin et chef d'atelier, refusé à client et technicien.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies: Partial<Record<TestUserRole, string>> = {};
const LEAK = "SECRET_SQL_select_from_stock_movements_9f3a";

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.get("set-cookie")!.split(";")[0];
}

const get = (path: string, role: TestUserRole) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookies[role]! } });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const role of ["admin", "workshop_manager", "technician", "client"] as const) await login(role);
}, 120000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function expectNormalised500(res: Response) {
  const text = await res.text();
  expect(res.status).toBe(500);
  expect(text).not.toContain(LEAK);
  const body = JSON.parse(text);
  expect(typeof body.code).toBe("string");
  expect(body.code.length).toBeGreaterThan(0);
  expect(typeof body.requestId).toBe("string");
  expect(body.requestId.length).toBeGreaterThan(0);
  expect(body.requestId).toBe(res.headers.get("x-request-id"));
}

/** Erreur métier levée par la lecture : le gestionnaire central garde son statut et son message (un `catch` local la mettait en 500). */
async function expectCentralHandler(res: Response) {
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.message).toBe("Lecture momentanément indisponible.");
  expect(body.requestId).toBe(res.headers.get("x-request-id"));
}

describe("GET /api/parts/stock-movements", () => {
  it("erreur applicative : statut et message conservés par le gestionnaire central", async () => {
    vi.spyOn(storage, "getAllStockMovements").mockRejectedValue(new AppError(409, "Lecture momentanément indisponible."));
    await expectCentralHandler(await get("/api/parts/stock-movements", "admin"));
  });

  it("liste globale en échec : 500 normalisé avec requestId, sans détail", async () => {
    vi.spyOn(storage, "getAllStockMovements").mockRejectedValue(new Error(LEAK));
    await expectNormalised500(await get("/api/parts/stock-movements", "admin"));
  });

  it("historique d'une pièce en échec : 500 normalisé avec requestId, sans détail", async () => {
    vi.spyOn(storage, "getPartStockHistory").mockRejectedValue(new Error(LEAK));
    await expectNormalised500(await get("/api/parts/stock-movements?partId=1", "technician"));
  });

  it("refuse un client (403) et un identifiant invalide (400)", async () => {
    expect((await get("/api/parts/stock-movements", "client")).status).toBe(403);
    const res = await get("/api/parts/stock-movements?partId=abc", "admin");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("ID de pièce invalide");
  });

  it("200 pour le personnel, forme inchangée (tableau)", async () => {
    const res = await get("/api/parts/stock-movements", "admin");
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe("GET /api/statistics/maintenance-cost/:period", () => {
  it("erreur applicative : statut et message conservés par le gestionnaire central", async () => {
    vi.spyOn(storage, "getMaintenanceCost").mockRejectedValue(new AppError(409, "Lecture momentanément indisponible."));
    await expectCentralHandler(await get("/api/statistics/maintenance-cost/year", "admin"));
  });

  it("coût en échec : 500 normalisé avec requestId, sans détail", async () => {
    vi.spyOn(storage, "getMaintenanceCost").mockRejectedValue(new Error(LEAK));
    await expectNormalised500(await get("/api/statistics/maintenance-cost/year", "admin"));
  });

  it.each(["client", "technician"] as const)("refuse %s (403)", async (role) => {
    expect((await get("/api/statistics/maintenance-cost/year", role)).status).toBe(403);
  });

  it.each(["admin", "workshop_manager"] as const)("200 pour %s, forme { cost }", async (role) => {
    const res = await get("/api/statistics/maintenance-cost/month", role);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["cost"]);
  });

  it("période invalide : 400", async () => {
    const res = await get("/api/statistics/maintenance-cost/decade", "admin");
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Période invalide");
  });
});
