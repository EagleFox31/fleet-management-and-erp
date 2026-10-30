import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLogs } from "../../shared/schema";
import { AUDIT_LOGS_PATH, auditLogsResponseSchema } from "../../shared/contracts/audit-logs";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-15 : journal d'audit en lecture admin. */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const TYPE = `t15_${Date.now()}`;
let adminId = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user;
}
async function get(query: string, role?: string) {
  const res = await fetch(`${baseUrl}${AUDIT_LOGS_PATH}?${query}`, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  adminId = (await login("admin")).id;
  for (const role of ["workshop_manager", "management", "client"] as const) await login(role);
  const old = new Date(Date.now() - 90 * 86_400_000);
  await db.insert(activityLogs).values([
    { userId: adminId, action: "create", entityType: TYPE, entityId: 7, method: "POST", path: "/api/x", details: { name: "a", password: "secret" } },
    { userId: adminId, action: "UPDATE", entityType: TYPE, entityRef: "CLE-1", method: "PATCH", path: "/api/x/1", details: null },
    { userId: null, action: "delete", entityType: TYPE, entityId: 9, method: "DELETE", path: "/api/x/9", details: null },
    { userId: adminId, action: "create", entityType: TYPE, entityId: 1, method: "POST", path: "/api/old", details: null, createdAt: old },
  ]);
}, 180000);
afterAll(async () => {
  await db.delete(activityLogs).where(eq(activityLogs.entityType, TYPE));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/audit-logs", { timeout: 120000 }, () => {
  it("refuse sans session et a tout role autre que l'administrateur", async () => {
    expect((await get("")).status).toBe(401);
    for (const role of ["workshop_manager", "management", "client"]) expect((await get("", role)).status).toBe(403);
  });

  it("filtre, masque les secrets et exclut ce qui depasse la plage par defaut", async () => {
    const r = await get(`entityType=${TYPE}`, "admin");
    expect(r.status).toBe(200);
    expect(auditLogsResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.total).toBe(3);
    const created = r.body.items.find((i: { entityId: string }) => i.entityId === "7");
    expect(created.details.password).toBe("***");
    expect(created.userName).toBeTruthy();
    expect(r.body.items.map((i: { action: string }) => i.action)).toContain("update");
    expect((await get(`entityType=${TYPE}&entityId=CLE-1`, "admin")).body.total).toBe(1);
    expect((await get(`entityType=${TYPE}&entityId=9`, "admin")).body.total).toBe(1);
    expect((await get(`entityType=${TYPE}&userId=${adminId}`, "admin")).body.total).toBe(2);
    const wide = await get(`entityType=${TYPE}&from=2000-01-01`, "admin");
    expect(wide.body.total).toBe(4);
  });

  it("pagine, borne la page a 100 et rejette une plage inversee", async () => {
    const p = await get(`entityType=${TYPE}&pageSize=2&page=2`, "admin");
    expect(p.body.items).toHaveLength(1);
    expect(p.body.total).toBe(3);
    expect((await get(`entityType=${TYPE}&pageSize=200`, "admin")).body.pageSize).toBe(100);
    expect((await get("from=2026-02-01&to=2026-01-01", "admin")).status).toBe(400);
  });
});
