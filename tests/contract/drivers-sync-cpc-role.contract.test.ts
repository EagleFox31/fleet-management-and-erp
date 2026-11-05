import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { storedLockoutKey } from "../../server/services/login-lockout-db-store";

/**
 * POST /api/drivers/sync-cpc-statuses : maintenance réservée aux gestionnaires de
 * chauffeurs (isDriverManager). Les autres rôles du personnel reçoivent 403, sans session 401.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();

async function loginAs(role: "admin" | "logistics" | "secretary" | "workshop_manager" | "technician" | "driver" | "client") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const sync = (cookie?: string) =>
  fetch(`${baseUrl}/api/drivers/sync-cpc-statuses`, { method: "POST", headers: cookie ? { Cookie: cookie } : {} });

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  const keys = ids.userIds.flatMap((id) => [`pwd:${id}`, `pin:${id}`]);
  await pool.query("DELETE FROM login_attempts_by_username WHERE username_normalized = ANY($1)", [keys.map(storedLockoutKey)]);
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("synchronisation des statuts CPC : rôles", { timeout: 60000 }, () => {
  it("sans session : 401", async () => {
    expect((await sync()).status).toBe(401);
  });

  it.each(["workshop_manager", "technician", "driver", "client"] as const)("%s : 403", async (role) => {
    expect((await sync(await loginAs(role))).status).toBe(403);
  });

  it.each(["admin", "logistics", "secretary"] as const)("%s : 200", async (role) => {
    expect((await sync(await loginAs(role))).status).toBe(200);
  });
});
