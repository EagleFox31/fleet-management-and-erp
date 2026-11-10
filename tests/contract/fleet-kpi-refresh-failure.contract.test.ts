import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { vehicleStatusService } from "../../server/services/vehicle-status-service";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Recalcul des KPI en échec (`POST /api/statistics/fleet-kpi/refresh`) : la route ne doit pas
 * annoncer « KPI recalculés avec succès » sur un cache resté périmé, ni exposer le détail technique.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("POST /api/statistics/fleet-kpi/refresh : échec du calcul", { timeout: 120000 }, () => {
  it("répond en erreur serveur, sans message de succès ni détail technique", async () => {
    const user = await createTestUser({ role: "admin" });
    ids.userIds.push(user.id);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    const spy = vi
      .spyOn(vehicleStatusService as any, "getFleetStatistics")
      .mockRejectedValue(new Error("panne simulée"));
    const res = await fetch(`${baseUrl}/api/statistics/fleet-kpi/refresh`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie } });
    spy.mockRestore();

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("succès");
    expect(text).not.toContain("panne simulée");
  });
});
