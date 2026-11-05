import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientBillingService } from "../../server/services/client-billing-service";
import { getContractApp } from "../support/app";
import { apiErrorProblems, leakText, TECHNICAL } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * AGENTS.md §10 : les lectures de `billing.routes.ts` répondaient `{ error: error.message }` en 500.
 * Elles relaient désormais au gestionnaire central (`withLogContext` + `next`), qui journalise
 * l'erreur et répond le message générique avec la référence.
 *
 * Non-régression : la garde de sortie du gestionnaire réécrivait déjà toute 5xx, ces cas passaient
 * avant le correctif. Le correctif retire le détail à la source et garde la journalisation.
 */

const SERVICE_ERROR = 'relation "client_invoices" does not exist';
const ID = 2147483000;

const ROUTES: Array<{ path: string; method: keyof typeof clientBillingService }> = [
  { path: "/api/billing/invoices", method: "getClientInvoices" },
  { path: "/api/billing/invoices/summary", method: "getClientInvoices" },
  { path: `/api/billing/invoices/${ID}`, method: "getInvoiceById" },
  { path: `/api/billing/invoices/${ID}/payments`, method: "getInvoicePayments" },
  { path: `/api/billing/invoices/${ID}/pdf`, method: "getInvoiceById" },
  { path: "/api/billing/reports/ACME?year=2026", method: "getClientBillingReport" },
  { path: "/api/billing/statistics", method: "getBillingStatistics" },
];

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanupCreated(ids);
});

describe("Facturation client : une 500 sans détail technique", { timeout: 120000 }, () => {
  for (const { path, method } of ROUTES) {
    it(`GET ${path} : message générique et référence, sans le message du service`, async () => {
      const spy = vi.spyOn(clientBillingService, method as never).mockRejectedValueOnce(new Error(SERVICE_ERROR) as never);
      const res = await fetch(baseUrl + path, { headers: { Cookie: cookie } });
      spy.mockRestore();
      const body = await res.json();
      expect(apiErrorProblems(res.status, body, 500, undefined, res.headers.get("x-request-id"))).toEqual([]);
      expect(body).not.toHaveProperty("error");
      expect(leakText(body)).not.toContain(SERVICE_ERROR);
      expect(leakText(body)).not.toMatch(TECHNICAL);
    });
  }
});
