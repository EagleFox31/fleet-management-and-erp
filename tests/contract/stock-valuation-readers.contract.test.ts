import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STAFF_ROLES, STOCK_VALUATION_READ_ROLES } from "../../shared/constants/roles";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Valuation du stock : réservée à STOCK_VALUATION_READ_ROLES (personnel hors chauffeur).
 * Le chauffeur et le client reçoivent 403 sans aucun montant ; le magasinier et le technicien lisent.
 * Pneus (`/api/tires/statistics*`) : même ensemble, par `isTireValuationReader`.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies: Partial<Record<TestUserRole, string>> = {};

const VALUATION_ROUTES = [
  "/api/warehouse/inventory-value",
  "/api/warehouse/reorder-alerts",
  "/api/warehouse/most-used-parts",
  "/api/warehouse/statistics",
  "/api/warehouse/parts-by-supplier",
  "/api/warehouse/top-consumed-parts",
  "/api/warehouse/stock-value-history",
  "/api/parts/statistics",
  "/api/tires/statistics",
  "/api/tires/statistics-advanced",
];

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

const get = (path: string, role?: TestUserRole) =>
  fetch(`${baseUrl}${path}`, role ? { headers: { Cookie: cookies[role]! } } : undefined);

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const role of ["warehouse", "technician", "secretary", "logistics", "driver", "client"] as const) await login(role);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ensemble des lecteurs de la valuation", () => {
  it("personnel hors chauffeur : ni chauffeur ni client, magasin et atelier inclus", () => {
    expect(STOCK_VALUATION_READ_ROLES).not.toContain("driver");
    expect(STOCK_VALUATION_READ_ROLES).not.toContain("client");
    expect([...STOCK_VALUATION_READ_ROLES].sort()).toEqual(STAFF_ROLES.filter((r) => r !== "driver").sort());
  });
});

describe.each(VALUATION_ROUTES)("GET %s", { timeout: 120000 }, (path) => {
  it("chauffeur : 403 par la garde, aucun montant", async () => {
    const res = await get(path, "driver");
    expect(res.status).toBe(403);
    const body = JSON.parse(await res.text());
    expect(body.message).toBe("Accès non autorisé");
    expect(Object.keys(body).sort()).toEqual(["code", "message", "requestId"]);
  });

  it("client : 403", async () => {
    expect((await get(path, "client")).status).toBe(403);
  });

  it("sans session : 401", async () => {
    expect((await get(path)).status).toBe(401);
  });

  it.each(["warehouse", "technician"] as const)("%s : 200", async (role) => {
    expect((await get(path, role)).status).toBe(200);
  });
});

describe("GET /api/invoices/:id/parts (prix et valeur par pièce)", { timeout: 120000 }, () => {
  const path = "/api/invoices/999999999/parts";

  it("chauffeur : 403 par la garde, avant toute lecture", async () => {
    const res = await get(path, "driver");
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text()).message).toBe("Accès non autorisé");
    expect((await get("/API/Invoices/999999999/Parts/", "driver")).status).toBe(403);
  });

  // Comptabilité (secrétariat) et logistique lisent les factures : elles gardent l'accès.
  it.each(["warehouse", "technician", "secretary", "logistics"] as const)("%s : franchit la garde (ni 401 ni 403)", async (role) => {
    expect([401, 403]).not.toContain((await get(path, role)).status);
  });
});

describe("variantes de chemin", { timeout: 120000 }, () => {
  it("casse et barre finale : la garde s'applique toujours au chauffeur", async () => {
    expect((await get("/API/Parts/Statistics/", "driver")).status).toBe(403);
    expect((await get("/API/Warehouse/Inventory-Value/", "driver")).status).toBe(403);
  });
});

describe("stock réel d'une pièce (sans montant) : reste ouvert au personnel", { timeout: 120000 }, () => {
  it("chauffeur : ni 401 ni 403", async () => {
    const res = await get("/api/warehouse/parts/999999999/real-stock", "driver");
    expect([401, 403]).not.toContain(res.status);
  });
});
