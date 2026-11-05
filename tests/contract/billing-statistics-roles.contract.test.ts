import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * `GET /api/billing/statistics` : la direction (management) lit les statistiques de facturation
 * client (décision du 5 novembre 2026). Les autres routes de facturation restent réservées à
 * admin, secrétaire et logistique.
 */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();

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
async function get(path: string, role?: TestUserRole) {
  const res = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return res.status;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["management", "client", "technician", "secretary"] as const) await login(role);
}, 180000);
afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("statistiques de facturation client : rôles", { timeout: 120000 }, () => {
  it("management et secrétaire : 200", async () => {
    expect(await get("/api/billing/statistics", "management")).toBe(200);
    expect(await get("/api/billing/statistics", "secretary")).toBe(200);
  });

  it("client, technicien, anonyme : refusés", async () => {
    expect(await get("/api/billing/statistics", "client")).toBe(403);
    expect(await get("/api/billing/statistics", "technician")).toBe(403);
    expect(await get("/api/billing/statistics")).toBe(401);
  });

  it("management reste exclu des autres lectures de facturation", async () => {
    expect(await get("/api/billing/invoices", "management")).toBe(403);
  });
});
