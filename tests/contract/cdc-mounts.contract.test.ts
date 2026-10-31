import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_APP_ROLES, type AppRole } from "../../shared/constants/roles";
import type { FeatureKey } from "../../shared/feature-flags";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { MOUNT_CASES, TELEMETRY_CASE } from "../support/cdc-mounts";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Montages CDC-0a (server/api/index.ts) avec de vraies sessions : 401 sans session, 404 drapeau
 * coupé, 403 rôle refusé, 501 squelette. Aucune donnée métier n'est lue ni écrite : seuls des
 * comptes TEST* sont créés puis supprimés. Jumeau sans base : tests/unit/server/cdc-mounts.test.ts.
 */
const previousFlags = process.env.FEATURE_FLAGS;
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<AppRole, string>();

const flagsOn = (keys: readonly FeatureKey[]) => keys.map((key) => `${key}=on`).join(",");

async function call(method: string, path: string, role?: AppRole): Promise<number> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: method === "GET" ? undefined : JSON.stringify({}),
  });
  return response.status;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ALL_APP_ROLES) {
    const user = await createTestUser({ role: role as never });
    ids.userIds.push(user.id);
    const res = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status, `connexion ${role}`).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
});

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe.each(MOUNT_CASES)("montage $name", { timeout: 120000 }, (mount) => {
  const denied = ALL_APP_ROLES.filter((role) => !mount.allowed.includes(role));

  it("drapeau coupé (défaut) : 404, session ou non", async () => {
    delete process.env.FEATURE_FLAGS;
    expect(await call(mount.method, mount.path)).toBe(404);
    expect(await call(mount.method, mount.path, mount.allowed[0])).toBe(404);
  });

  it("drapeaux allumés, sans session : 401", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    expect(await call(mount.method, mount.path)).toBe(401);
  });

  it("drapeaux allumés, rôle refusé : 403", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    for (const role of denied) expect(await call(mount.method, mount.path, role), role).toBe(403);
  });

  it("drapeaux allumés, rôle autorisé : 501 (squelette)", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    for (const role of mount.allowed) expect(await call(mount.method, mount.path, role), role).toBe(501);
  });
});

describe("montage /telemetry (sans session)", { timeout: 60000 }, () => {
  it("drapeau gps coupé : 404", async () => {
    delete process.env.FEATURE_FLAGS;
    expect(await call(TELEMETRY_CASE.method, TELEMETRY_CASE.path)).toBe(404);
  });
  it("drapeau gps allumé : 501 sans session", async () => {
    process.env.FEATURE_FLAGS = flagsOn(TELEMETRY_CASE.flags);
    expect(await call(TELEMETRY_CASE.method, TELEMETRY_CASE.path)).toBe(501);
  });
});
