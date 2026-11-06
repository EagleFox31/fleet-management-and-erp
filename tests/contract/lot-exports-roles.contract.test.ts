import { messageText } from "../support/api-error";
import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_APP_ROLES, type AppRole } from "../../shared/constants/roles";
import { EXPORT_PATHS, EXPORT_ROLE_MATRIX, EXPORTS_BASE_PATH } from "../../shared/contracts/exports";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Niveau C, P-01 : matrice de roles des exports et garde `isStaff` au montage.
 *
 * Avant le correctif, ces routes n'exigeaient qu'une session : un client, un
 * chauffeur ou un technicien telechargeait factures, stock et rapport comptable
 * de tous. Le test de garde de session ne prouve pas la garde de role.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<AppRole, string>();

/**
 * `kpi-report` est derriere le drapeau `kpi-reports` (coupe par defaut) : sans
 * lui la route repond 404 et la matrice de roles n'est pas mise a l'epreuve.
 * Le cas « drapeau coupe → 404 » vit dans kpi-cdc.contract.test.ts.
 */
const previousFlags = process.env.FEATURE_FLAGS;

/**
 * La base de test est partagee entre agents : un nettoyage concurrent peut
 * supprimer un compte ou une session en cours de route. Un 401 sur un role
 * authentifie provoque donc une recreation du compte, une seule fois.
 */
async function provision(role: AppRole) {
  const user = await createTestUser({ role: role as TestUserRole });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
}

async function get(path: string, role?: AppRole, retried = false): Promise<{ status: number; headers: Headers; text: () => string }> {
  const response = await fetch(baseUrl + path, {
    headers: role ? { Cookie: cookies.get(role)! } : {},
  });
  const body = await response.arrayBuffer();
  if (role && response.status === 401 && !retried) {
    await provision(role);
    return get(path, role, true);
  }
  return { status: response.status, headers: response.headers, text: () => Buffer.from(body).toString("utf8") };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "exports=on,kpi-reports=on";
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const role of ALL_APP_ROLES) await provision(role);
}, 120000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("exports : matrice de roles (EXPORT_ROLE_MATRIX)", { timeout: 60000 }, () => {
  it("la matrice refuse le client partout", () => {
    for (const path of EXPORT_PATHS) expect(EXPORT_ROLE_MATRIX[path]).not.toContain("client");
  });

  for (const path of EXPORT_PATHS) {
    it(`GET ${EXPORTS_BASE_PATH}/${path} : sans session 401`, async () => {
      expect((await get(`${EXPORTS_BASE_PATH}/${path}`)).status).toBe(401);
    });

    for (const role of ALL_APP_ROLES) {
      const allowed = (EXPORT_ROLE_MATRIX[path] as readonly string[]).includes(role);
      it(`GET ${EXPORTS_BASE_PATH}/${path} : ${role} -> ${allowed ? "200" : "403"}`, async () => {
        const res = await get(`${EXPORTS_BASE_PATH}/${path}?year=2026&month=10`, role);
        if (allowed) {
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toMatch(/spreadsheetml\.sheet|application\/zip/);
        } else {
          expect(res.status).toBe(403);
          expect(JSON.parse(res.text())).toMatchObject({ code: "FORBIDDEN" });
        }
      });
    }
  }
});

const STAFF_MOUNTS = [
  "/api/warehouse/parts/999999999/real-stock",
  "/api/fuel-card/balance",
  "/api/drivers",
  "/api/missions",
  "/api/clients",
  "/api/operations/missions",
  "/api/part-requirements",
] as const;

describe("garde isStaff au montage (T-62)", { timeout: 60000 }, () => {
  for (const path of STAFF_MOUNTS) {
    it(`${path} : anonyme 401`, async () => {
      expect((await get(path)).status).toBe(401);
    });
    it(`${path} : client 403`, async () => {
      const res = await get(path, "client");
      expect(res.status).toBe(403);
    });
    for (const role of ["technician", "driver"] as const) {
      it(`${path} : ${role} n'est ni 401 ni 403`, async () => {
        const res = await get(path, role);
        expect([401, 403]).not.toContain(res.status);
      });
    }
  }
});

describe("exports : validation et en-tetes (T-11a)", { timeout: 60000 }, () => {
  it("annee ou mois invalides : 400 normalise, sans detail technique", async () => {
    for (const q of ["year=abc&month=10", "year=2026&month=13", "month=10"]) {
      const res = await get(`${EXPORTS_BASE_PATH}/monthly-report?${q}`, "admin");
      expect(res.status).toBe(400);
      const body = JSON.parse(res.text());
      expect(body).toMatchObject({ code: expect.any(String), message: expect.any(String) });
      expect(messageText(body)).not.toMatch(/zod|invalid_type|stack/i);
    }
  });

  it("clientName assaini dans Content-Disposition", async () => {
    const res = await get(`${EXPORTS_BASE_PATH}/client-operations?clientName=${encodeURIComponent('A"B\r\nX-Evil: 1')}`, "admin");
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9_.-]+"$/);
    expect(res.headers.get("x-evil")).toBeNull();
  });
});
