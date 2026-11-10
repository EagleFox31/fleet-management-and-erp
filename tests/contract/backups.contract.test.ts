import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { backupRuns } from "../../shared/schema";
import { backupAlertsResponseSchema, backupRunsResponseSchema, runBackupResponseSchema } from "../../shared/contracts/backups";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Sauvegardes (T-20): droits admin, liste sans chemin de fichier, alertes, pas de doublon pendant
 * une exécution. Le déclenchement réel (pg_dump) n'est pas lancé ici: il écrirait un dump de la base
 * de test; on prouve le chemin « déjà en cours » avec une ligne `running` posée par le test.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const runIds: number[] = [];

async function call(method: string, path: string, cookie?: string) {
  const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function login(username: string): Promise<string> {
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  if (runIds.length > 0) await db.delete(backupRuns).where(inArray(backupRuns.id, runIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("sauvegardes (admin)", { timeout: 180000 }, () => {
  it("réserve les routes à l'admin, masque le chemin, ne double pas une exécution", async () => {
    const admin = await createTestUser({ role: "admin" });
    const manager = await createTestUser({ role: "workshop_manager" });
    ids.userIds.push(admin.id, manager.id);
    const [adminCookie, managerCookie] = await Promise.all([login(admin.username), login(manager.username)]);

    for (const [method, path] of [
      ["GET", "/api/admin/backups"],
      ["GET", "/api/admin/backups/alerts"],
      ["POST", "/api/admin/backups/run"],
    ] as const) {
      expect((await call(method, path)).status).toBe(401);
      expect((await call(method, path, managerCookie)).status).toBe(403);
    }

    const [done, running] = await db
      .insert(backupRuns)
      .values([
        {
          startedAt: new Date("2031-01-01T02:00:00Z"),
          finishedAt: new Date("2031-01-01T02:00:05Z"),
          status: "success",
          sizeBytes: 1234,
          checksum: "abc",
          location: "/secret/chemin/fichier.dump.enc",
        },
        { startedAt: new Date(), status: "running" },
      ])
      .returning();
    runIds.push(done.id, running.id);

    const list = await call("GET", "/api/admin/backups", adminCookie);
    expect(list.status).toBe(200);
    expect(backupRunsResponseSchema.safeParse(list.body).success).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain("/secret/chemin");
    const times = list.body.map((r: { startedAt: string }) => Date.parse(r.startedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(list.body.find((r: { id: number }) => r.id === done.id).durationMs).toBe(5000);

    const alerts = await call("GET", "/api/admin/backups/alerts", adminCookie);
    expect(alerts.status).toBe(200);
    expect(backupAlertsResponseSchema.safeParse(alerts.body).success).toBe(true);

    // Une exécution tourne déjà: 202 avec elle, aucune seconde ligne.
    const before = (await call("GET", "/api/admin/backups", adminCookie)).body.length;
    const again = await call("POST", "/api/admin/backups/run", adminCookie);
    expect(again.status).toBe(202);
    expect(runBackupResponseSchema.parse(again.body).id).toBe(running.id);
    expect((await call("GET", "/api/admin/backups", adminCookie)).body.length).toBe(before);
  });
});
