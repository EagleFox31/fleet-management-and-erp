import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notificationSettingsResponseSchema } from "../../shared/contracts/notification-settings";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** T-18 : GET et PATCH /api/notifications/settings (réglages propres à chaque utilisateur). */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies: Record<string, string> = {};

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) as any, headers: response.headers };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const [label, role] of [["a", "technician"], ["b", "warehouse"]] as [string, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    (cookies as any)[`${label}Id`] = user.id;
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies[label] = res.headers.get("set-cookie")!.split(";")[0];
  }
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("/api/notifications/settings", () => {
  it("refuse sans session", async () => {
    expect((await call("GET", "/api/notifications/settings")).status).toBe(401);
  });

  it("renvoie les 9 thèmes par défaut", async () => {
    const res = await call("GET", "/api/notifications/settings", { cookie: cookies.a });
    expect(res.status).toBe(200);
    const rows = notificationSettingsResponseSchema.parse(res.body);
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.inApp && !r.email)).toBe(true);
  });

  it("A désactive documents ; autre compte (B) : garde la sienne ; userId du corps ignoré ; idempotent", async () => {
    const patch = { body: [{ topic: "documents", inApp: false, userId: (cookies as any).bId }], cookie: cookies.a };
    const first = await call("PATCH", "/api/notifications/settings", patch);
    expect(first.status).toBe(200);
    const second = await call("PATCH", "/api/notifications/settings", patch);
    expect(second.body).toEqual(first.body);
    const a = notificationSettingsResponseSchema.parse((await call("GET", "/api/notifications/settings", { cookie: cookies.a })).body);
    const b = notificationSettingsResponseSchema.parse((await call("GET", "/api/notifications/settings", { cookie: cookies.b })).body);
    expect(a.find((r) => r.topic === "documents")?.inApp).toBe(false);
    expect(b.find((r) => r.topic === "documents")?.inApp).toBe(true);
  });

  it("ignore email tant que le drapeau est coupé", async () => {
    const res = await call("PATCH", "/api/notifications/settings", { cookie: cookies.a, body: [{ topic: "fuel", email: true }] });
    expect(res.status).toBe(200);
    expect(res.body.find((r: any) => r.topic === "fuel").email).toBe(false);
  });

  it("répond 400 sur un thème inconnu", async () => {
    const res = await call("PATCH", "/api/notifications/settings", { cookie: cookies.a, body: [{ topic: "inconnu", inApp: false }] });
    expect(res.status).toBe(400);
  });
});
