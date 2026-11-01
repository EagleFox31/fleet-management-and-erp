import { createServer, type Server } from "http";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { setAuditSink } from "../../server/lib/audit";
import { AUDIT_MASK } from "../../shared/contracts/audit-logs";
import { dbAuditSink } from "../../server/lib/audit-db-sink";
import { activityLogs, users } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * ADM6 : les actions sensitives sur les comptes laissent une ligne
 * `activity_logs` attribuée à l'admin qui agit, secrets masqués ; une action
 * refusée (403) n'en laisse aucune. La liste des chemins audités est gelée
 * par `tests/unit/server/audit-config.test.ts`, la lecture du journal par
 * `audit-logs`.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
let admin: { id: number; cookie: string };

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

async function loginAs(role: "admin" | "warehouse") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
  expect(res.status).toBe(200);
  return { id: user.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

type AuditRow = typeof activityLogs.$inferSelect;

/** L'audit s'écrit après la réponse : on attend les lignes au plus ~3 s. */
async function pollAudit(where: ReturnType<typeof and>, expected: number): Promise<AuditRow[]> {
  let rows: AuditRow[] = [];
  for (let i = 0; i < 20; i++) {
    rows = await db.select().from(activityLogs).where(where).orderBy(desc(activityLogs.id));
    if (rows.length >= expected) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return rows;
}

const auditRowsFor = (entityId: number, expected: number) =>
  pollAudit(and(eq(activityLogs.entityType, "user"), eq(activityLogs.entityId, String(entityId))), expected);

beforeAll(async () => {
  setAuditSink(dbAuditSink);
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  admin = await loginAs("admin");
});

afterAll(async () => {
  setAuditSink(null);
  if (ids.userIds.length) {
    const asText = ids.userIds.map(String);
    await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
    await db
      .delete(activityLogs)
      .where(and(eq(activityLogs.entityType, "user"), inArray(activityLogs.entityId, asText)));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ADM6 : journal d'activité des actions sur les comptes", { timeout: 60000 }, () => {
  it("création de compte : auteur, entité et mot de passe masqué", async () => {
    const token = uniqueTestToken("audit");
    const res = await call("POST", "/api/users", {
      cookie: admin.cookie,
      body: { username: token, email: `${token}@fleet.test`, name: token, role: "warehouse", password: "Secret-123!" },
    });
    expect(res.status).toBe(201);
    ids.userIds.push(res.body.id);

    // Création : pas d'id dans le chemin, donc pas d'entityId ; on cible la
    // ligne par le nom d'utilisateur unique du compte créé.
    const rows = await pollAudit(
      and(
        eq(activityLogs.entityType, "user"),
        eq(activityLogs.action, "create"),
        sql`${activityLogs.details}->>'username' = ${token}`,
      ),
      1,
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.userId).toBe(admin.id);
    expect(row).toMatchObject({ method: "POST", path: "/api/users" });
    const details = row.details as Record<string, unknown>;
    expect(details.username).toBe(token);
    expect(details.password).toBe(AUDIT_MASK);
    expect(JSON.stringify(details)).not.toContain("Secret-123!");
  });

  it("changement de rôle puis suppression : deux lignes attribuées à l'admin", async () => {
    const target = await createTestUser({ role: "warehouse" });
    ids.userIds.push(target.id);

    expect((await call("PATCH", `/api/users/${target.id}`, { cookie: admin.cookie, body: { role: "technician" } })).status).toBe(200);
    expect((await call("DELETE", `/api/users/${target.id}`, { cookie: admin.cookie })).status).toBe(204);

    const rows = await auditRowsFor(target.id, 2);
    expect(rows.map((r) => r.method).sort()).toEqual(["DELETE", "PATCH"]);
    for (const row of rows) expect(row.userId).toBe(admin.id);
    const patch = rows.find((r) => r.method === "PATCH")!;
    expect((patch.details as Record<string, unknown>).role).toBe("technician");
  });

  it("action refusée (403) : aucune ligne", async () => {
    const warehouse = await loginAs("warehouse");
    const target = await createTestUser({ role: "warehouse" });
    ids.userIds.push(target.id);

    expect((await call("DELETE", `/api/users/${target.id}`, { cookie: warehouse.cookie })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 600));
    expect(await auditRowsFor(target.id, 0)).toHaveLength(0);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row.deletedAt).toBeNull();
  });
});
