import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { clientInvoices } from "../../shared/schema";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import {
  FINANCE_RECEIVABLES_AGING_PATH,
  financeReceivablesAgingResponseSchema,
  type FinanceReceivablesAgingResponse,
} from "../../shared/contracts/finance-receivables-aging";
import { clientStatementPath, clientStatementResponseSchema } from "../../shared/contracts/client-statement";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestClient, createTestClientInvoice } from "../support/factories";

/**
 * GET /api/finance/receivables-aging : balance âgée des factures en attente de paiement.
 * - Rôles : `FINANCE_RECEIVABLE_READ_ROLES` (admin, management, secretary, logistics) ; autres 403.
 * - Tranches depuis le dépôt, bornes incluses : 0-30, 31-60, 61-90, +90 j ; non déposée à part.
 * - Factures réglées ou annulées exclues (périmètre de la liste des factures en attente).
 * - `amountDue` = reste dû après règlements ; un règlement partiel réel (POST paiement) le réduit,
 *   et le total du client égale le solde de clôture de son relevé.
 * Les dépôts sont datés relativement à aujourd'hui (Africa/Douala) ; les assertions portent sur un
 * client dédié, d'autres fichiers pouvant laisser des factures en attente. Tout est supprimé.
 */
const previousFlags = process.env.FEATURE_FLAGS;

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "management" | "secretary" | "logistics" | "warehouse" | "workshop" | "technician" | "driver" | "client">>>;
let clientId = 0;
let partialClientId = 0;
let partialInvoiceId = 0;

/** Date `days` jours avant aujourd'hui à Africa/Douala. */
function daysAgo(days: number): string {
  const [y, m, d] = isoDateInZone(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

async function invoice(depositDaysAgo: number | null, net: string, status: "pending" | "partial" | "overdue" | "paid" | "cancelled" = "pending", owner = clientId) {
  const row = await createTestClientInvoice({
    clientId: owner,
    invoiceDate: daysAgo(200),
    amountHT: "10000.00",
    vatAmount: "1925.00",
    amountTTC: "11925.00",
    status,
  });
  session.ids.clientInvoiceIds.push(row.id);
  if (depositDaysAgo !== null) {
    await db
      .update(clientInvoices)
      .set({ depositedAt: daysAgo(depositDaysAgo), withholdingVatAmount: "0.00", withholdingIsAmount: "0.00", netPayable: net })
      .where(eq(clientInvoices.id, row.id));
  }
  return row.id;
}

const mine = (body: FinanceReceivablesAgingResponse) => body.byClient.find((c) => c.clientId === clientId);

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "finance=on";
  session = await startContractSession({
    admin: "admin",
    management: "management",
    secretary: "secretary",
    logistics: "logistics",
    warehouse: "warehouse",
    workshop: "workshop_manager",
    technician: "technician",
    driver: "driver",
    client: "client",
  });
  const row = await createTestClient();
  session.ids.clientIds.push(row.id);
  clientId = row.id;
  // Bornes de chaque tranche (net figé distinct pour vérifier les sommes).
  await invoice(0, "100.00");
  await invoice(30, "200.00", "partial");
  await invoice(31, "400.00", "overdue");
  await invoice(60, "800.00");
  await invoice(61, "1600.00");
  await invoice(90, "3200.00");
  await invoice(91, "6400.00");
  await invoice(null, "0");
  // Hors périmètre : réglée, annulée.
  await invoice(10, "50000.00", "paid");
  await invoice(10, "50000.00", "cancelled");
  // Client dédié au règlement partiel : facture déposée il y a 45 jours, réglée en partie ensuite.
  const other = await createTestClient();
  session.ids.clientIds.push(other.id);
  partialClientId = other.id;
  partialInvoiceId = await invoice(45, "11925.00", "pending", partialClientId);
}, 180000);

afterAll(async () => {
  await session.stop();
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor: null })).status).toBe(401);
  });

  it.each(["warehouse", "workshop", "technician", "driver", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor })).status).toBe(403);
  });

  it.each(["admin", "management", "secretary", "logistics"] as const)("%s : 200 au contrat", async (actor) => {
    const r = await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor });
    expect(r.status).toBe(200);
    financeReceivablesAgingResponseSchema.parse(r.body);
  });
});

describe("drapeau", () => {
  it("drapeau finance coupé : 404, même pour un rôle autorisé", async () => {
    process.env.FEATURE_FLAGS = "finance=off";
    try {
      expect((await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor: "admin" })).status).toBe(404);
    } finally {
      process.env.FEATURE_FLAGS = "finance=on";
    }
  });
});

describe("paramètres", () => {
  it.each(["clientId=1", "asOf=2026-01-01"])("%s : 400 lisible", async (query) => {
    const r = await session.call("GET", `${FINANCE_RECEIVABLES_AGING_PATH}?${query}`, { actor: "admin" });
    expect(apiErrorProblems(r.status, r.body, 400)).toEqual([]);
    expect(r.body.message).toBe("Paramètre non reconnu.");
  });
});

describe("balance âgée", () => {
  it("tranches bornes incluses, non déposée à part, réglée et annulée exclues", async () => {
    const r = await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor: "secretary" });
    const body = financeReceivablesAgingResponseSchema.parse(r.body);
    expect(body.asOf).toBe(isoDateInZone(new Date()));
    const row = mine(body);
    expect(row).toMatchObject({
      days0to30: { count: 2, amountTtc: 23850, netPayable: 300 },
      days31to60: { count: 2, amountTtc: 23850, netPayable: 1200 },
      days61to90: { count: 2, amountTtc: 23850, netPayable: 4800 },
      over90: { count: 1, amountTtc: 11925, netPayable: 6400 },
      notDeposited: { count: 1, amountTtc: 11925 },
    });
    expect(row?.total).toMatchObject({ count: 8, amountDue: 95400, amountTtc: 95400 });
  });

  it("règlement partiel réel : la tranche porte le reste dû, égal au solde du relevé client", async () => {
    const paid = await session.call("POST", `/api/billing/invoices/${partialInvoiceId}/payments`, {
      actor: "admin",
      body: { amount: 4000, paymentDate: isoDateInZone(new Date()), paymentMethod: "bank_transfer", reference: "VIR-AGING" },
    });
    expect(paid.status).toBeLessThan(300);
    const r = await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor: "logistics" });
    const row = financeReceivablesAgingResponseSchema.parse(r.body).byClient.find((c) => c.clientId === partialClientId);
    expect(row?.days31to60).toEqual({ count: 1, amountDue: 7925, amountTtc: 11925, netPayable: 11925 });
    expect(row?.total.amountDue).toBe(7925);
    const st = await session.call("GET", clientStatementPath(partialClientId), { actor: "admin" });
    expect(st.status).toBe(200);
    expect(clientStatementResponseSchema.parse(st.body).closingBalance).toBe(row?.total.amountDue);
  });

  it("totaux = somme des lignes clients, par tranche", async () => {
    const r = await session.call("GET", FINANCE_RECEIVABLES_AGING_PATH, { actor: "admin" });
    const body = financeReceivablesAgingResponseSchema.parse(r.body);
    for (const key of ["notDeposited", "days0to30", "days31to60", "days61to90", "over90", "total"] as const) {
      for (const field of ["amountDue", "amountTtc"] as const) {
        const cents = body.byClient.reduce((t, c) => t + Math.round(c[key][field] * 100), 0);
        expect(Math.round(body.totals[key][field] * 100)).toBe(cents);
      }
      expect(body.totals[key].count).toBe(body.byClient.reduce((t, c) => t + c[key].count, 0));
    }
  });
});
