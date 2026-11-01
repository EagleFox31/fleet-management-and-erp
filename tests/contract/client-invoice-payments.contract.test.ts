import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientInvoices, clientPayments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, CINV1 : paiements partiels d'une facture client et solde.
 * - Statut : pending -> partial -> partial -> paid, solde = TTC moins la somme des paiements.
 * - Montants à centimes : la somme exacte solde la facture (pas de reliquat flottant, pas de « partial » à 0).
 * - Facture soldée : un nouveau paiement est refusé (409), rien n'est écrit.
 * - Historique des paiements et synthèse de facturation cohérents avec le solde.
 * Écrit en base ; tout est supprimé (les paiements partent avec la facture).
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function newInvoice(totalTTC: string, clientId?: number) {
  const cid = clientId ?? (await createTestClient()).id;
  if (!clientId) ids.clientIds.push(cid);
  const invoice = await createTestClientInvoice({
    clientId: cid,
    amountHT: totalTTC,
    vatAmount: "0.00",
    amountTTC: totalTTC,
  });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

const pay = (invoiceId: number, amount: number) =>
  call("POST", `/api/billing/invoices/${invoiceId}/payments`, {
    amount,
    paymentDate: "2026-10-29",
    paymentMethod: "cash",
    reference: uniqueTestToken("pay"),
  });

async function stateOf(invoiceId: number) {
  const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { invoice, payments };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const user = await createTestUser({ role: "secretary" });
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
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("CINV1 paiements partiels et solde", { timeout: 120000 }, () => {
  it("trois paiements : pending -> partial -> partial -> paid, solde juste à chaque étape", async () => {
    const invoice = await newInvoice("100000.00");
    expect(invoice.status).toBe("pending");

    expect((await pay(invoice.id, 30000)).status).toBe(200);
    let state = await stateOf(invoice.id);
    expect(state.invoice).toMatchObject({ status: "partial" });
    expect(Number(state.invoice.balance)).toBe(70000);

    expect((await pay(invoice.id, 20000)).status).toBe(200);
    state = await stateOf(invoice.id);
    expect(state.invoice).toMatchObject({ status: "partial" });
    expect(Number(state.invoice.balance)).toBe(50000);

    expect((await pay(invoice.id, 50000)).status).toBe(200);
    state = await stateOf(invoice.id);
    expect(state.invoice).toMatchObject({ status: "paid" });
    expect(Number(state.invoice.balance)).toBe(0);
    expect(state.payments).toHaveLength(3);
    expect(state.payments.reduce((sum, p) => sum + Number(p.amount), 0)).toBe(100000);

    const history = await call("GET", `/api/billing/invoices/${invoice.id}/payments`);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain(String(state.payments[0].id));
  });

  it("montants à centimes dont la somme égale le TTC : facture soldée, jamais « partial » à 0,00", async () => {
    const invoice = await newInvoice("100000.00");
    for (const amount of [33333.33, 33333.33, 33333.34]) {
      const res = await pay(invoice.id, amount);
      expect(res.status, String(amount)).toBe(200);
    }
    const { invoice: row, payments } = await stateOf(invoice.id);
    expect(payments).toHaveLength(3);
    expect(Number(row.balance)).toBe(0);
    expect(row.status).toBe("paid");
  });

  it("centimes décimaux en série (0,10 + 0,20 sur 0,30) : soldé", async () => {
    const invoice = await newInvoice("0.30");
    expect((await pay(invoice.id, 0.1)).status).toBe(200);
    expect((await pay(invoice.id, 0.2)).status).toBe(200);
    const { invoice: row } = await stateOf(invoice.id);
    expect(Number(row.balance)).toBe(0);
    expect(row.status).toBe("paid");
  });

  it("facture soldée : nouveau paiement refusé en 409, rien n'est écrit", async () => {
    const invoice = await newInvoice("50000.00");
    expect((await pay(invoice.id, 50000)).status).toBe(200);

    const again = await pay(invoice.id, 1);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/soldée|solde/i);
    const { invoice: row, payments } = await stateOf(invoice.id);
    expect(payments).toHaveLength(1);
    expect(Number(row.balance)).toBe(0);
    expect(row.status).toBe("paid");
  });

  it("synthèse d'un client : payé + solde = TTC, compteurs par statut", async () => {
    const client = await createTestClient();
    ids.clientIds.push(client.id);
    const partial = await newInvoice("100000.00", client.id);
    const paid = await newInvoice("40000.00", client.id);
    await newInvoice("10000.00", client.id);
    expect((await pay(partial.id, 25000)).status).toBe(200);
    expect((await pay(paid.id, 40000)).status).toBe(200);

    const res = await call("GET", `/api/billing/invoices/summary?clientId=${client.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, pending: 1, partial: 1, paid: 1 });
    expect(res.body.totalAmountTTC).toBe(150000);
    expect(res.body.totalPaid).toBe(65000);
    expect(res.body.totalBalance).toBe(85000);
    expect(res.body.totalPaid + res.body.totalBalance).toBe(res.body.totalAmountTTC);
  });
});
