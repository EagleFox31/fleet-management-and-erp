import { createServer, type Server } from "http";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { idempotencyStore } from "../../server/lib/idempotency-store";
import { idempotencyKeys, parts, partsStockMovements } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Niveau C, idempotence de l'ajustement de stock (`POST /api/parts/:id/update-stock`).
 * - Même clé rejouée -> même réponse, en-tête `Idempotent-Replayed`, un seul ajustement.
 *   Avant : la route n'était pas protégée, un réessai après coupure ajustait deux fois.
 * - Protégée même drapeau `idempotency` coupé (option de route `ignoreFeatureFlag`).
 * - Enregistrement de la réponse en échec après le commit : la clé est conservée, le réessai
 *   reçoit un 409 lisible (« vérifiez le stock ») et n'ajuste rien. Avant : clé libérée, le
 *   réessai rejouait l'ajustement.
 * - Sans clé : comportement inchangé.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let userId = 0;
const ids = createIdBag();

async function adjust(partId: number, adjustment: number, key?: string) {
  const response = await fetch(`${baseUrl}/api/parts/${partId}/update-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify({ adjustment, reason: "TEST idempotence" }),
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function stateOf(partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: part.quantity, movements: movements.length };
}

async function newPart(quantity: number) {
  const part = await createTestPart({ quantity });
  ids.partIds.push(part.id);
  return part;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const user = await createTestUser({ role: "warehouse" });
  ids.userIds.push(user.id);
  userId = user.id;
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, userId));
  if (ids.partIds.length > 0) await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Ajustement de stock : idempotence", { timeout: 120000 }, () => {
  it("même clé rejouée -> même réponse, un seul ajustement (drapeau coupé par défaut)", async () => {
    const part = await newPart(10);
    const before = await stateOf(part.id);
    const key = uniqueTestToken("idem");
    const first = await adjust(part.id, 3, key);
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    const second = await adjust(part.id, 3, key);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.body).toEqual(first.body);
    const after = await stateOf(part.id);
    expect(after.quantity).toBe(13);
    expect(after.movements - before.movements).toBe(1);
  });

  it("enregistrement de la réponse en échec après le commit -> clé conservée, réessai en 409 sans ajustement", async () => {
    const part = await newPart(10);
    const before = await stateOf(part.id);
    const key = uniqueTestToken("idem");
    vi.spyOn(idempotencyStore, "complete").mockRejectedValueOnce(new Error("panne simulée"));
    const first = await adjust(part.id, 4, key);
    expect(first.status).toBe(200);
    const retry = await adjust(part.id, 4, key);
    expect(retry.status).toBe(409);
    expect(retry.body.message).toContain("vérifiez le stock");
    expect(leakText(retry.body)).not.toMatch(/panne simulée|stack|SQLSTATE/);
    const after = await stateOf(part.id);
    expect(after.quantity).toBe(14);
    expect(after.movements - before.movements).toBe(1);
    const [row] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    expect(row.state).toBe("in_progress");
  });

  it("nouvelle intention, nouvelle clé -> l'ajustement s'applique", async () => {
    const part = await newPart(10);
    expect((await adjust(part.id, 2, uniqueTestToken("idem"))).status).toBe(200);
    expect((await adjust(part.id, 2, uniqueTestToken("idem"))).status).toBe(200);
    expect((await stateOf(part.id)).quantity).toBe(14);
  });

  it("sans clé : comportement inchangé", async () => {
    const part = await newPart(10);
    expect((await adjust(part.id, 1)).status).toBe(200);
    expect((await adjust(part.id, 1)).status).toBe(200);
    expect((await stateOf(part.id)).quantity).toBe(12);
  });
});
