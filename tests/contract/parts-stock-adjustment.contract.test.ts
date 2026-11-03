import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts, partsStockMovements } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { leakText } from "../support/api-error";

/**
 * Niveau C, ajustement manuel de stock (`POST /api/parts/:id/update-stock`).
 * - T1 : rôle non autorisé -> 403.
 * - T3 : ajustement non numérique, décimal, nul ou raison absente -> 400 lisible, stock intact.
 *   Avant : un ajustement non numérique remontait l'erreur SQL dans un 500.
 * - Retrait au-delà du stock -> 409 lisible (avant : ramené à 0 en silence).
 * - Deux ajustements simultanés s'additionnent (avant : l'un écrasait l'autre).
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
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

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|invalid input/);
}

async function newPart(quantity: number) {
  const part = await createTestPart({ quantity });
  ids.partIds.push(part.id);
  return part;
}

function adjust(partId: number, body: Record<string, unknown>, role: TestUserRole = "warehouse") {
  return call("POST", `/api/parts/${partId}/update-stock`, { cookie: cookies.get(role), body });
}

async function stateOf(partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: part.quantity, movements };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ["warehouse", "technician"] as TestUserRole[]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Ajustement de stock : contrat", { timeout: 120000 }, () => {
  it("T1 : refusé au technicien", async () => {
    const part = await newPart(10);
    const res = await adjust(part.id, { adjustment: 3, reason: "TEST" }, "technician");
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
    expect((await stateOf(part.id)).quantity).toBe(10);
  });

  it.each([
    { label: "ajustement non numérique", body: { adjustment: "abc", reason: "TEST" } },
    { label: "ajustement décimal", body: { adjustment: 1.5, reason: "TEST" } },
    { label: "ajustement nul", body: { adjustment: 0, reason: "TEST" } },
    { label: "raison absente", body: { adjustment: 3 } },
  ])("T3 : $label -> 400 lisible, stock intact", async ({ body }) => {
    const part = await newPart(10);
    const res = await adjust(part.id, body);
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(res.body.errors?.length).toBeGreaterThan(0);
    const state = await stateOf(part.id);
    expect(state.quantity).toBe(10);
    expect(state.movements).toHaveLength(0);
  });

  it("retrait au-delà du stock -> 409 lisible, stock intact", async () => {
    const part = await newPart(5);
    const res = await adjust(part.id, { adjustment: -8, reason: "TEST" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toContain("5 unité(s) en stock");
    expect((await stateOf(part.id)).quantity).toBe(5);
  });

  it("pièce inexistante -> 404 lisible", async () => {
    const res = await adjust(2147483647, { adjustment: 3, reason: "TEST" });
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("deux ajustements simultanés s'additionnent", async () => {
    const part = await newPart(10);
    const results = await Promise.all([
      adjust(part.id, { adjustment: 3, reason: "TEST" }),
      adjust(part.id, { adjustment: 3, reason: "TEST" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const state = await stateOf(part.id);
    expect(state.quantity).toBe(16);
    expect(state.movements).toHaveLength(2);
  });
});
