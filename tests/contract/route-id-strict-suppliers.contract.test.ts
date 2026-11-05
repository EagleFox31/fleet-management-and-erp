import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { eq } from "drizzle-orm";
import { suppliers } from "@shared/schema";
import { db } from "../../server/db";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lot 2 de #360 : fournisseurs. `parseInt("1abc")` valait 1 : la route lisait, modifiait ou
 * désactivait le fournisseur 1. Elle répond 400 « ID invalide » par `parseRouteId`.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

const CASES: Array<[method: string, url: string, message: string]> = [
  ["GET", "/api/suppliers/1abc", "ID invalide"],
  ["PATCH", "/api/suppliers/1abc", "ID invalide"],
  ["DELETE", "/api/suppliers/1abc", "ID invalide"],
  ["GET", "/api/suppliers/1abc/performance", "ID invalide"],
  ["PATCH", "/api/suppliers/1abc/rating", "ID invalide"],
  ["POST", "/api/suppliers/1abc/calculate-ratings", "ID invalide"],
  ["PATCH", "/api/suppliers/1abc/reactivate", "ID invalide"],
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

describe("ids de route fournisseurs (lot 2) : 400, jamais le fournisseur 1", { timeout: 120000 }, () => {
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

  it("DELETE /<id>abc ne désactive pas le fournisseur <id>", async () => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const response = await fetch(`${baseUrl}/api/suppliers/${supplier.id}abc`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(response.status).toBe(400);
    const [row] = await db.select({ isActive: suppliers.isActive }).from(suppliers).where(eq(suppliers.id, supplier.id));
    expect(row.isActive).toBe(true);
  });
});
