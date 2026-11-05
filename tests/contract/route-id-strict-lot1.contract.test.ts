import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 1 de #360 : un id de route se lit par `parseRouteId`. `parseInt("1abc")` valait 1 et
 * `Number("1e0")` aussi : la route visait alors l'objet 1 au lieu de refuser. Chaque route
 * répond 400 avec son message, avant toute lecture en base.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

const CASES: Array<[method: string, url: string, message: string]> = [
  ["PATCH", "/api/fault-catalog/1abc", "ID invalide"],
  ["PATCH", "/api/purchase-orders/1abc/lines/1", "Commande ou ligne invalide."],
  ["PATCH", "/api/purchase-orders/1/lines/1abc", "Commande ou ligne invalide."],
  ["PATCH", "/api/supplier-invoices/1abc/settlements/1/reject", "Identifiant invalide."],
  ["PATCH", "/api/supplier-invoices/1/settlements/1abc/reconcile", "ID invalide"],
  ["DELETE", "/api/documents/1abc", "ID de document invalide"],
  ["PATCH", "/api/documents/1abc", "ID de document invalide"],
  ["GET", "/api/warehouse/parts/1e0/real-stock", "ID de pièce invalide"],
  ["DELETE", "/api/missions/1/assignments/1abc", "ID affectation invalide."],
];

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route stricts (lot 1) : 400, jamais l'objet 1", { timeout: 120000 }, () => {
  it.each(CASES)("%s %s : 400", async (method, url, message) => {
    const response = await fetch(baseUrl + url, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    const body = (await response.json()) as { message?: string };
    expect(response.status).toBe(400);
    expect(body.message).toBe(message);
  });
});
