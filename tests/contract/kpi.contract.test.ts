import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  avgCostPerInterventionResponseSchema,
  incidentsPerMonthResponseSchema,
  KPI_AVG_COST_PER_INTERVENTION_PATH,
  KPI_INCIDENTS_PER_MONTH_PATH,
  KPI_PREVENTIVE_COMPLIANCE_PATH,
  preventiveComplianceResponseSchema,
} from "../../shared/contracts/kpi";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-25 : KPI de la direction. */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();

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
}
async function get(path: string, role?: string) {
  const res = await fetch(baseUrl + path, { headers: role ? { Cookie: cookies.get(role)! } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["admin", "management", "technician", "client"] as const) await login(role);
}, 180000);
afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

const PATHS = [KPI_INCIDENTS_PER_MONTH_PATH, KPI_PREVENTIVE_COMPLIANCE_PATH, KPI_AVG_COST_PER_INTERVENTION_PATH];

describe("/api/kpi/*", { timeout: 120000 }, () => {
  it.each(PATHS)("%s : 401 sans session, 403 technicien et client", async (path) => {
    expect((await get(path)).status).toBe(401);
    expect((await get(path, "technician")).status).toBe(403);
    expect((await get(path, "client")).status).toBe(403);
  });

  it("sert les trois indicateurs conformes au contrat a la direction et a l'admin", async () => {
    for (const role of ["management", "admin"]) {
      const q = "?from=2020-01-01&to=2020-12-31";
      const a = await get(KPI_INCIDENTS_PER_MONTH_PATH + q, role);
      expect(a.status).toBe(200);
      expect(incidentsPerMonthResponseSchema.safeParse(a.body).success).toBe(true);
      const b = await get(KPI_PREVENTIVE_COMPLIANCE_PATH + q, role);
      expect(b.status).toBe(200);
      expect(preventiveComplianceResponseSchema.safeParse(b.body).success).toBe(true);
      const c = await get(KPI_AVG_COST_PER_INTERVENTION_PATH + q, role);
      expect(c.status).toBe(200);
      expect(avgCostPerInterventionResponseSchema.safeParse(c.body).success).toBe(true);
    }
  });

  it("refuse une periode inversee ou mal formee en 400", async () => {
    expect((await get(KPI_INCIDENTS_PER_MONTH_PATH + "?from=2021-01-01&to=2020-01-01", "management")).status).toBe(400);
    expect((await get(KPI_PREVENTIVE_COMPLIANCE_PATH + "?from=hier", "management")).status).toBe(400);
  });
});
