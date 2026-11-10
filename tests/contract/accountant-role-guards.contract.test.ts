import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startContractSession } from "../support/contract-session";

/**
 * Rôle comptable (`accountant`, 10 novembre 2026) : lit et règle l'argent, n'écrit rien
 * d'opérationnel. Le 403 sur l'atelier, le stock et les missions est garanti ici ; les lectures
 * finance répondent 200. La secrétaire est rejouée sur les mêmes routes : l'ajout du rôle ne lui
 * retire rien.
 */

process.env.FEATURE_FLAGS = "finance=on,pending-invoices=on";

type Actor = "accountant" | "secretary";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

beforeAll(async () => {
  session = await startContractSession<Actor>({ accountant: "accountant", secretary: "secretary" });
}, 120000);

afterAll(async () => {
  await session?.stop();
});

const WRITE_ROUTES: Array<[string, string, Record<string, unknown>]> = [
  ["POST", "/api/work-orders", { vehicleId: 1, title: "OT comptable", type: "corrective", priority: "medium" }],
  ["POST", "/api/tires", { brand: "X", model: "Y", size: "315/80R22.5", quantity: 1, unitPrice: "1000" }],
  ["POST", "/api/missions", { name: "Mission comptable", vehicleId: 1, driverId: 1, departureDate: "2037-01-01" }],
  ["POST", "/api/purchase-orders", { supplierId: 1, items: [] }],
  ["POST", "/api/vehicles", { plate: "CPT-0001", type: "camion" }],
  ["POST", "/api/drivers", { firstName: "A", lastName: "B" }],
  ["POST", "/api/fuel-card/recharge", { amount: 1000, unitPrice: 800, date: "2037-01-01", paymentMode: "virement" }],
];

describe("comptable : écritures opérationnelles refusées", { timeout: 120000 }, () => {
  it.each(WRITE_ROUTES)("%s %s → 403", async (method, path, body) => {
    const res = await session.call(method, path, { actor: "accountant", body });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
  });
});

const FINANCE_READS = [
  "/api/supplier-invoices/statistics",
  "/api/billing/pending-invoices",
  "/api/finance/receivables-aging",
  "/api/treasury/accounts",
  "/api/fuel-card/balance",
];

describe("comptable : lectures finance ouvertes", { timeout: 120000 }, () => {
  it.each(FINANCE_READS)("GET %s → 200 pour le comptable", async (path) => {
    const res = await session.call("GET", path, { actor: "accountant" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  });

  it.each(FINANCE_READS)("GET %s → 200 toujours pour la secrétaire (non-régression)", async (path) => {
    const res = await session.call("GET", path, { actor: "secretary" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  });

  it("GET /api/supplier-invoices → 200 : la garde de montage accepte le comptable", async () => {
    const res = await session.call("GET", "/api/supplier-invoices", { actor: "accountant" });
    expect(res.status).toBe(200);
  });
});
