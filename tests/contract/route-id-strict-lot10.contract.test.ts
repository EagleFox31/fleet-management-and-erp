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
 * Lot 10 de #360 : `billing.routes.ts` lisait l'id par `const { id } = req.params; parseInt(id)`,
 * forme que le cliquet `route-id-parse-hygiene` voit désormais. `<id>abc` où `<id>` existe répond 400,
 * et la facture `<id>` reste telle quelle : ni paiement écrit, ni statut changé.
 * Les paiements partent avec la facture (cascade) : le ménage tient même après un rouge.
 */

const MESSAGE = "Identifiant de facture invalide.";

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
  const json = (await response.json().catch(() => null)) as { message?: string } | null;
  return { status: response.status, message: json?.message };
}

async function newInvoice() {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id, amountHT: "1000.00", vatAmount: "0.00", amountTTC: "1000.00" });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

const payment = () => ({ amount: 100, paymentDate: "2026-11-05", paymentMethod: "cash", reference: uniqueTestToken("lot10") });

async function stateOf(invoiceId: number) {
  const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select({ id: clientPayments.id }).from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { invoice, payments };
}

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
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 10) : factures client, paiement intact", { timeout: 120000 }, () => {
  it("POST /api/billing/invoices/<id>abc/payments : 400, facture et paiements inchangés", async () => {
    const invoice = await newInvoice();
    const before = await stateOf(invoice.id);

    expect(await call("POST", `/api/billing/invoices/${invoice.id}abc/payments`, payment())).toEqual({ status: 400, message: MESSAGE });

    const after = await stateOf(invoice.id);
    expect(after.payments).toHaveLength(0);
    expect(after.invoice).toEqual(before.invoice);
  });

  it("POST .../payments sur un id hors de l'int4 : 400", async () => {
    expect(await call("POST", "/api/billing/invoices/99999999999/payments", payment())).toEqual({ status: 400, message: MESSAGE });
  });

  it("témoin : POST /api/billing/invoices/<id>/payments enregistre le paiement", async () => {
    const invoice = await newInvoice();
    expect((await call("POST", `/api/billing/invoices/${invoice.id}/payments`, payment())).status).toBe(200);
    expect((await stateOf(invoice.id)).payments).toHaveLength(1);
  });

  it.each(["", "/payments", "/pdf"])("GET /api/billing/invoices/<id>abc%s : 400", async (suffix) => {
    const invoice = await newInvoice();
    expect(await call("GET", `/api/billing/invoices/${invoice.id}abc${suffix}`)).toEqual({ status: 400, message: MESSAGE });
  });
});
