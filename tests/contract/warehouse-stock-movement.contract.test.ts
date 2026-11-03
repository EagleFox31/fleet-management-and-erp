import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { parts, partsStockMovements } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { leakText } from "../support/api-error";

/**
 * Niveau C, mouvement de stock magasin (`POST /api/warehouse/stock-movement`).
 * - Sortie au-delà du stock -> 409 lisible, stock et journal intacts.
 *   Avant : stock ramené à 0 en silence, mouvement journalisé avec un `newStock` faux.
 * - Pièce inexistante -> 404 lisible. Avant : 500 portant le message brut.
 * - Quantité décimale -> 400 lisible, rien n'est écrit.
 * - Sorties concurrentes : jamais plus que le stock, chaîne previous -> new continue.
 *   Avant : lecture hors transaction, chaque sortie partait du même stock initial.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json, headers: response.headers };
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|invalid input|non trouvée/);
}

async function newPart(quantity: number) {
  const part = await createTestPart({ quantity });
  ids.partIds.push(part.id);
  return part;
}

function move(partId: number, type: "in" | "out", quantity: number) {
  return call("POST", "/api/warehouse/stock-movement", { partId, type, quantity, reason: "TEST" });
}

async function stateOf(partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const movements = await db
    .select()
    .from(partsStockMovements)
    .where(eq(partsStockMovements.partId, partId))
    .orderBy(partsStockMovements.id);
  return { quantity: part.quantity, movements };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const user = await createTestUser({ role: "warehouse" });
  ids.userIds.push(user.id);
  const res = await call("POST", "/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Mouvement de stock magasin : contrat", { timeout: 120000 }, () => {
  it("sortie au-delà du stock -> 409 lisible, stock et journal intacts", async () => {
    const part = await newPart(5);
    const res = await move(part.id, "out", 8);
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toContain("5 unité(s) en stock");
    const state = await stateOf(part.id);
    expect(state.quantity).toBe(5);
    expect(state.movements).toHaveLength(0);
  });

  it("pièce inexistante -> 404 lisible", async () => {
    const res = await move(2147483647, "in", 3);
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("quantité décimale -> 400 lisible, rien n'est écrit", async () => {
    const part = await newPart(5);
    const res = await move(part.id, "in", 1.5);
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    const state = await stateOf(part.id);
    expect(state.quantity).toBe(5);
    expect(state.movements).toHaveLength(0);
  });

  it("sorties concurrentes : jamais plus que le stock, chaîne de mouvements continue", async () => {
    const part = await newPart(10);
    const results = await Promise.all([move(part.id, "out", 4), move(part.id, "out", 4), move(part.id, "out", 4)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 409]);

    const state = await stateOf(part.id);
    expect(state.quantity).toBe(2);
    expect(state.movements).toHaveLength(2);
    expect(state.movements[0].previousStock).toBe(10);
    expect(state.movements[0].newStock).toBe(6);
    expect(state.movements[1].previousStock).toBe(6);
    expect(state.movements[1].newStock).toBe(2);
  });

  it("entrées concurrentes : elles s'additionnent", async () => {
    const part = await newPart(10);
    const results = await Promise.all([move(part.id, "in", 3), move(part.id, "in", 3)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const state = await stateOf(part.id);
    expect(state.quantity).toBe(16);
    expect(state.movements).toHaveLength(2);
  });
});
