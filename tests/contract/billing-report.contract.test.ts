import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestClient, createTestClientInvoice } from "../support/factories";

/**
 * GET /api/billing/reports/:clientName?year=AAAA[&month=M] : rapport de facturation d'un client.
 * - Rôles : `CLIENT_BILLING_EVENT_ROLES` (admin, secretary, logistics) ; autres profils 403.
 * - Période : année sur quatre chiffres obligatoire, mois 1-12 facultatif ; sinon 400 lisible.
 * - Client inconnu : rapport vide (200), pas de 404.
 * Écrit en base ; client et factures supprimés en fin de fichier.
 */
const reportPath = (name: string, query: string) => `/api/billing/reports/${encodeURIComponent(name)}?${query}`;

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "secretary" | "logistics" | "management" | "technician" | "client">>>;
let clientName = "";
let clientId = 0;

beforeAll(async () => {
  session = await startContractSession({
    admin: "admin",
    secretary: "secretary",
    logistics: "logistics",
    management: "management",
    technician: "technician",
    client: "client",
  });
  const client = await createTestClient();
  session.ids.clientIds.push(client.id);
  clientName = client.name;
  clientId = client.id;
  const rows = [
    { invoiceDate: "2026-01-10", amountHT: "84000.00", vatAmount: "16000.00", amountTTC: "100000.00", balance: "60000.00" },
    { invoiceDate: "2026-03-05", amountHT: "42000.00", vatAmount: "8000.00", amountTTC: "50000.00", balance: "50000.00" },
    { invoiceDate: "2025-12-31", amountHT: "8400.00", vatAmount: "1600.00", amountTTC: "10000.00", balance: "0.00" },
  ];
  for (const row of rows) {
    const invoice = await createTestClientInvoice({ clientId, ...row });
    session.ids.clientInvoiceIds.push(invoice.id);
  }
}, 180000);

afterAll(async () => {
  await session.stop();
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", reportPath(clientName, "year=2026"), { actor: null })).status).toBe(401);
  });

  it.each(["management", "technician", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", reportPath(clientName, "year=2026"), { actor })).status).toBe(403);
  });

  it.each(["admin", "secretary", "logistics"] as const)("%s : 200", async (actor) => {
    expect((await session.call("GET", reportPath(clientName, "year=2026"), { actor })).status).toBe(200);
  });
});

describe("période", () => {
  it.each([
    ["", "L'année est requise."],
    ["year=", "L'année est requise."],
    ["year=abc", "Année attendue sur quatre chiffres."],
    ["year=2026x", "Année attendue sur quatre chiffres."],
    ["year[]=2026", "Année attendue sur quatre chiffres."],
    ["year=2026&month=13", "Mois attendu entre 1 et 12."],
    ["year=2026&month=0", "Mois attendu entre 1 et 12."],
    ["year=2026&month=3x", "Mois attendu entre 1 et 12."],
  ])("%s : 400 lisible", async (query, message) => {
    const r = await session.call("GET", reportPath(clientName, query), { actor: "admin" });
    expect(apiErrorProblems(r.status, r.body, 400)).toEqual([]);
    expect(r.body.message).toBe(message);
  });
});

describe("calcul", () => {
  it("année : factures de l'année seulement, totaux HT, TVA, TTC, payé, restant", async () => {
    const r = await session.call("GET", reportPath(clientName, "year=2026"), { actor: "secretary" });
    expect(r.body).toMatchObject({
      clientName,
      clientId,
      period: "2026",
      totalInvoices: 2,
      totalAmountHT: 126000,
      totalVAT: 24000,
      totalAmountTTC: 150000,
      totalPaid: 40000,
      totalOutstanding: 110000,
    });
    expect(r.body.invoices.map((i: { invoiceDate: string }) => i.invoiceDate).sort()).toEqual(["2026-01-10", "2026-03-05"]);
  });

  it("mois : une facture, mois à un ou deux chiffres", async () => {
    for (const month of ["3", "03"]) {
      const r = await session.call("GET", reportPath(clientName, `year=2026&month=${month}`), { actor: "admin" });
      expect(r.body).toMatchObject({ period: "3/2026", totalInvoices: 1, totalAmountTTC: 50000, totalOutstanding: 50000 });
    }
  });

  it("client inconnu : rapport vide", async () => {
    const r = await session.call("GET", reportPath(`${clientName}-absent`, "year=2026"), { actor: "admin" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ totalInvoices: 0, totalAmountTTC: 0, invoices: [] });
  });
});
