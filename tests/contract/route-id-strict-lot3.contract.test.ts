import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTE_ID_OUT_OF_RANGE_MESSAGE } from "../../server/middleware/route-id-range-guard";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 3 de #360 : ids lus dans un middleware ou sans aucune garde. `parseInt("1abc")` valait 1 :
 * la garde d'évaluation fournisseur jugeait le fournisseur 1, et la création de compte chauffeur
 * visait le chauffeur 1. Un id non strict répond 400 ; un id valide inconnu garde sa réponse.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

const CASES: Array<[method: string, url: string, status: number, message: string]> = [
  ["PATCH", "/api/suppliers/1abc/rating", 400, "ID invalide"],
  ["PATCH", "/api/suppliers/abc/rating", 400, "ID invalide"],
  ["PATCH", "/api/suppliers/99999999999/rating", 400, ROUTE_ID_OUT_OF_RANGE_MESSAGE],
  ["PATCH", "/api/suppliers/2147483000/rating", 404, "Fournisseur non trouvé"],
  ["POST", "/api/drivers/1abc/update-cpc", 400, "ID de chauffeur invalide"],
  ["GET", "/api/drivers/1abc/cpc-status", 400, "ID de chauffeur invalide"],
  ["POST", "/api/drivers/1abc/create-user", 400, "ID de chauffeur invalide"],
  ["POST", "/api/drivers/2147483000/create-user", 404, "Chauffeur introuvable"],
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

describe("ids de route stricts (lot 3) : middleware et routes sans garde", { timeout: 120000 }, () => {
  it.each(CASES)("%s %s : %i", async (method, url, status, message) => {
    const response = await fetch(baseUrl + url, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify({ pin: "1234", email: "lot3@example.test", cpcDate: "2026-01-01" }),
    });
    const body = (await response.json()) as { message?: string };
    expect(response.status).toBe(status);
    expect(body.message).toBe(message);
  });
});
