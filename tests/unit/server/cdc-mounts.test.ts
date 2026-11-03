import express from "express";
import { createServer, type Server } from "http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Sans base : l'utilisateur de session est fourni par un faux `storage`, la session par un en-tête.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  process.env.AUTH_DEBUG = "0";
});
const ROLE_BY_ID = new Map<number, string>();
vi.mock("../../../server/services/session-user", () => ({
  findActiveSessionUser: async (id: number) =>
    ROLE_BY_ID.has(id) ? { id, username: `u${id}`, role: ROLE_BY_ID.get(id) } : undefined,
}));
vi.mock("../../../server/services/workshop-labor-rates-service", () => ({
  listWorkshopLaborRates: async () => [],
  createWorkshopLaborRate: async () => {
    throw new Error("non utilisé ici");
  },
}));
vi.mock("../../../server/middleware/session", () => ({
  sessionMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createApiRouter } from "../../../server/api";
import { errorHandler, requestContext } from "../../../server/middleware/error-handler";
import { ALL_APP_ROLES, type AppRole } from "../../../shared/constants/roles";
import { FEATURE_FLAGS, type FeatureKey } from "../../../shared/feature-flags";
import { MOUNT_CASES } from "../../support/cdc-mounts";

/**
 * Montages CDC-0a de server/api/index.ts, sans base : 404 drapeau coupé, 401 sans session,
 * 403 rôle refusé, 501 squelette. Le jumeau avec sessions réelles est
 * tests/contract/cdc-mounts.contract.test.ts.
 */
const ids = new Map<AppRole, number>();
ALL_APP_ROLES.forEach((role, index) => {
  ids.set(role, 9000 + index);
  ROLE_BY_ID.set(9000 + index, role);
});

let server: Server;
let baseUrl = "";
const previousFlags = process.env.FEATURE_FLAGS;

beforeAll(async () => {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  const fakeSession: express.RequestHandler = (req, _res, next) => {
    const header = req.header("x-test-role");
    if (header) (req as unknown as { session: { userId: number } }).session = { userId: ids.get(header as AppRole)! };
    next();
  };
  app.use("/api", createApiRouter(fakeSession));
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  delete process.env.FEATURE_FLAGS;
});

async function call(method: string, path: string, role?: AppRole) {
  const response = await fetch(baseUrl + path, { method, headers: role ? { "x-test-role": role } : {} });
  return response.status;
}
const flagsOn = (keys: readonly FeatureKey[]) => keys.map((key) => `${key}=on`).join(",");

describe.each(MOUNT_CASES)("montage $name", (mount) => {
  const denied = ALL_APP_ROLES.filter((role) => !mount.allowed.includes(role));

  it("drapeau coupé : 404 pour tous, session ou non", async () => {
    delete process.env.FEATURE_FLAGS;
    // Défaut : `exports` (must) est allumé, mais l'autre drapeau de la route est coupé.
    expect(await call(mount.method, mount.path)).toBe(404);
    expect(await call(mount.method, mount.path, mount.allowed[0])).toBe(404);
  });

  it.each(mount.flags)("un seul drapeau coupé (%s) : 404", async (cut) => {
    process.env.FEATURE_FLAGS = [flagsOn(mount.flags.filter((key) => key !== cut)), `${cut}=off`].filter(Boolean).join(",");
    expect(await call(mount.method, mount.path, mount.allowed[0])).toBe(404);
  });

  it("drapeaux allumés, sans session : 401", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    expect(await call(mount.method, mount.path)).toBe(401);
  });

  it("drapeaux allumés, rôle refusé : 403", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    expect(denied.length).toBeGreaterThan(0);
    for (const role of denied) expect(await call(mount.method, mount.path, role), role).toBe(403);
  });

  it("drapeaux allumés, rôle autorisé : atteint la route (501 squelette, ou statut `reached`)", async () => {
    process.env.FEATURE_FLAGS = flagsOn(mount.flags);
    for (const role of mount.allowed) expect(await call(mount.method, mount.path, role), role).toBe(mount.reached ?? 501);
  });
});

describe("montage workshop-labor-rates (lot #7 : route réelle, plus un squelette)", () => {
  const path = "/api/workshop-labor-rates";
  const others = ALL_APP_ROLES.filter((role) => role !== "admin");

  it("drapeau maintenance-report coupé : 404, session ou non", async () => {
    delete process.env.FEATURE_FLAGS;
    expect(await call("GET", path)).toBe(404);
    expect(await call("GET", path, "admin")).toBe(404);
  });

  it("drapeau allumé, sans session : 401", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    expect(await call("GET", path)).toBe(401);
  });

  it("drapeau allumé, tout rôle autre que l'administrateur : 403", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    for (const role of others) expect(await call("GET", path, role), role).toBe(403);
  });

  it("drapeau allumé, administrateur : 200 (liste)", async () => {
    process.env.FEATURE_FLAGS = "maintenance-report=on";
    expect(await call("GET", path, "admin")).toBe(200);
  });
});

describe("non-régression", () => {
  it("aucun drapeau CDC n'est allumé par défaut", () => {
    const cdc: FeatureKey[] = ["mission-maintenance-advisory", "part-qr", "part-sales", "kpi-reports", "maintenance-report", "excel-import", "technician-offline"];
    for (const key of cdc) expect(FEATURE_FLAGS[key], key).toMatchObject({ level: "should", defaultEnabled: false });
  });
  it("un chemin historique n'est pas masqué : /api/health répond 200", async () => {
    expect(await call("GET", "/api/health")).toBe(200);
  });
});
