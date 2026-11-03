import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
 * - Quantité décimale, hors entier SQL, ou entrée qui déborderait -> 400 lisible, rien n'est écrit.
 * - Sorties concurrentes : jamais plus que le stock, chaîne previous -> new continue.
 *   Avant : lecture hors transaction, chaque sortie partait du même stock initial.
 * - Trame `warehouse_stock_movement_recorded` (§2, §11) : personnel lisant le stock, ni chauffeur
 *   ni client connecté ; aucune trame sur un refus. Avant : broadcast à tous les profils.
 *   Les trames sont capturées à `broadcastUpdate`, leur portée résolue comme `realtime-scope.ts`.
 */

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; entityId?: unknown };
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const frames = () => captured.filter((f) => f.eventType === "warehouse_stock_movement_recorded");
const reachesRole = (scope: Scope | undefined, role: string, userId: number): boolean => {
  if (!scope) return false;
  if (scope.type === "broadcast") return true;
  if (scope.type === "user") return (scope.userIds ?? []).includes(userId);
  if (scope.type === "roles") return (scope.roles ?? []).map((r) => r.trim().toLowerCase()).includes(role);
  return false;
};
const roleUsers = new Map<string, number>();

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

  (global as any).broadcastUpdate = vi.fn((eventType: string, data: Omit<Captured, "eventType">) => {
    captured.push({ eventType, scope: data?.scope, entityId: data?.entityId });
  });
  for (const role of ["admin", "technician", "driver", "client"] as const) {
    const other = await createTestUser({ role });
    ids.userIds.push(other.id);
    roleUsers.set(role, other.id);
  }
  const user = await createTestUser({ role: "warehouse" });
  ids.userIds.push(user.id);
  roleUsers.set("warehouse", user.id);
  const res = await call("POST", "/api/auth/login", { username: user.username, password: TEST_USER_PASSWORD });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Mouvement de stock magasin : contrat", { timeout: 120000 }, () => {
  it("trame : personnel lisant le stock, ni chauffeur ni client connecté", async () => {
    const part = await newPart(5);
    captured.length = 0;
    const res = await move(part.id, "in", 2);
    expect(res.status).toBe(201);
    const all = frames();
    expect(all).toHaveLength(1);
    expect(all[0].entityId).toBe(part.id);
    expect(all[0].scope?.type).toBe("roles");
    for (const role of ["admin", "warehouse", "technician"]) expect(reachesRole(all[0].scope, role, roleUsers.get(role)!)).toBe(true);
    for (const role of ["driver", "client"]) expect(reachesRole(all[0].scope, role, roleUsers.get(role)!)).toBe(false);
  });

  it("sortie au-delà du stock -> 409 lisible, stock et journal intacts, aucune trame", async () => {
    const part = await newPart(5);
    captured.length = 0;
    const res = await move(part.id, "out", 8);
    expect(frames()).toHaveLength(0);
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

  it.each([
    ["quantité décimale", 1.5],
    ["quantité au-delà d'un entier SQL", 3_000_000_000],
    ["entrée qui ferait déborder le stock", 2_147_483_647],
  ])("%s -> 400 lisible, rien n'est écrit", async (_label, quantity) => {
    const part = await newPart(5);
    const res = await move(part.id, "in", quantity);
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
