import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { missions } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Complément dynamique de `api-auth-guard`: les routes durcies refusent
 * l'anonyme, et une mission créée porte son auteur réel (plus de repli sur
 * l'utilisateur 1). Écrit en base; tout ce qui est créé est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const missionIds: number[] = [];

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function login(username: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", {
    body: { username, password: TEST_USER_PASSWORD },
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  // Les missions d'abord: elles référencent l'utilisateur créateur.
  if (missionIds.length > 0) {
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

// Chaque test crée un compte puis ouvre une session: plusieurs allers-retours Neon.
describe("Sessions sur les routes durcies", { timeout: 30000 }, () => {
  it("refuse l'anonyme", async () => {
    expect((await call("POST", "/api/missions", { body: {} })).status).toBe(401);
    expect((await call("GET", "/api/technician/work-orders/1")).status).toBe(401);
    expect(
      (await call("POST", "/api/auth/register", {
        body: { username: uniqueTestToken("intrus"), password: "x", role: "admin" },
      })).status,
    ).toBe(401);
  });

  it("réserve l'inscription à l'admin", async () => {
    const warehouse = await createTestUser({ role: "warehouse" });
    ids.userIds.push(warehouse.id);
    const cookie = await login(warehouse.username);

    const res = await call("POST", "/api/auth/register", {
      cookie,
      body: { username: uniqueTestToken("intrus"), password: "x", role: "admin" },
    });
    expect(res.status).toBe(403);
  });

  it("borne un technicien à ses propres ordres de travail", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const cookie = await login(technician.username);

    expect((await call("GET", `/api/technician/work-orders/${technician.id + 100000}`, { cookie })).status).toBe(403);
    expect((await call("GET", `/api/technician/work-orders/${technician.id}`, { cookie })).status).toBe(200);
  });

  it("attribue la mission créée à l'utilisateur de la session", async () => {
    const logistics = await createTestUser({ role: "logistics" });
    ids.userIds.push(logistics.id);
    const cookie = await login(logistics.username);

    const res = await call("POST", "/api/missions", {
      cookie,
      body: {
        orderNumber: uniqueTestToken("mission"),
        pickupAddress: "Douala",
        deliveryAddress: "Yaoundé",
        // Un client ne peut pas usurper l'auteur.
        createdBy: 1,
      },
    });
    const mission = res.body as { id?: number; createdBy?: number } | null;
    if (mission?.id) missionIds.push(mission.id);

    expect(res.status).toBe(201);
    expect(mission?.createdBy).toBe(logistics.id);
  });
});
