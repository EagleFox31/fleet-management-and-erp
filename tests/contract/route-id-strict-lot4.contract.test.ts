import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drivers } from "@shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Lot 4 de #360 : les parseurs locaux qui contournaient le cliquet (`parseDriverId`,
 * `parseClientId`, `parseAlertId`, `idParam`) lisaient `"1abc"` comme 1. Ils délèguent à
 * `parseRouteId` : 400. Un chauffeur valide mais absent répond 404, plus 500.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const driverIds: number[] = [];
const ABSENT = 2147483000;

const CASES: Array<[method: string, url: string, status: number, message: string]> = [
  ["GET", "/api/drivers/1abc/missions", 400, "ID de chauffeur invalide"],
  ["GET", "/api/drivers/1abc", 400, "ID de chauffeur invalide"],
  ["PATCH", "/api/drivers/1abc", 400, "ID de chauffeur invalide"],
  ["PATCH", "/api/drivers/1abc/toggle", 400, "ID de chauffeur invalide"],
  ["DELETE", "/api/drivers/1abc", 400, "ID de chauffeur invalide"],
  ["GET", `/api/drivers/${ABSENT}`, 404, "Chauffeur introuvable"],
  ["GET", `/api/drivers/${ABSENT}/cpc-status`, 404, "Chauffeur introuvable"],
  ["POST", `/api/drivers/${ABSENT}/update-cpc`, 404, "Chauffeur introuvable"],
  ["GET", "/api/clients/1abc", 400, "Identifiant client invalide"],
  ["PATCH", "/api/clients/1abc", 400, "Identifiant client invalide"],
  ["DELETE", "/api/clients/1abc", 400, "Identifiant client invalide"],
  ["PATCH", "/api/clients/1abc/restore", 400, "Identifiant client invalide"],
  ["PATCH", "/api/alerts/1e0/read", 400, "Identifiant d'alerte invalide."],
  ["DELETE", "/api/alerts/1e0", 400, "Identifiant d'alerte invalide."],
  ["DELETE", "/api/fuel-records/1abc", 400, "Identifiant d'enregistrement de carburant invalide"],
  ["PATCH", "/api/document-renewals/centers/1abc", 404, "Centre agréé introuvable."],
];

async function newDriver() {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), employeeNumber: uniqueTestToken("emp"), isActive: true } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

function send(method: string, url: string) {
  return fetch(baseUrl + url, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify({ pin: "1234", email: "lot4@example.test", cpcDate: "2026-01-01" }),
  });
}

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
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 4) : parseurs locaux stricts, chauffeur absent en 404", { timeout: 120000 }, () => {
  it.each(CASES)("%s %s : %i", async (method, url, status, message) => {
    const response = await send(method, url);
    const body = (await response.json()) as { message?: string };
    expect(response.status).toBe(status);
    expect(body.message).toBe(message);
  });

  it("DELETE /api/drivers/<id>abc ne supprime pas le chauffeur <id>", async () => {
    const driver = await newDriver();
    expect((await send("DELETE", `/api/drivers/${driver.id}abc`)).status).toBe(400);
    const rows = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, driver.id));
    expect(rows).toHaveLength(1);
  });

  it("POST /api/drivers/<id>abc/create-user ne crée pas de compte au chauffeur <id>", async () => {
    const driver = await newDriver();
    expect((await send("POST", `/api/drivers/${driver.id}abc/create-user`)).status).toBe(400);
    const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, driver.id));
    expect(row.userId).toBeNull();
  });
});
