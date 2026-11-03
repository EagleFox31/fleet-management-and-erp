import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { clientInvoices, clientPayments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestClientInvoice, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Niveau C, encaissement d'une facture client (`POST /api/billing/invoices/:id/payments`).
 * - T1 : rôle non autorisé -> 403.
 * - T3 : montant ou mode de paiement invalide -> 400 lisible, solde intact.
 * - T7 : la même saisie rejouée -> 200 et le même paiement, solde baissé une fois ;
 *   un paiement au-delà du solde -> 409 lisible.
 */

const TOTAL = 119250;

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN/);
}

async function newInvoice() {
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const invoice = await createTestClientInvoice({ clientId: client.id });
  ids.clientInvoiceIds.push(invoice.id);
  return invoice;
}

function pay(invoiceId: number, body: Record<string, unknown>, role: TestUserRole = "secretary") {
  return call("POST", `/api/billing/invoices/${invoiceId}/payments`, { cookie: cookies.get(role), body });
}

async function stateOf(invoiceId: number) {
  const [invoice] = await db.select().from(clientInvoices).where(eq(clientInvoices.id, invoiceId));
  const payments = await db.select().from(clientPayments).where(eq(clientPayments.invoiceId, invoiceId));
  return { balance: invoice.balance, payments };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ["secretary", "technician"] as TestUserRole[]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  // Les paiements partent en cascade avec les factures.
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Encaissement client : contrat", { timeout: 120000 }, () => {
  it("T1 : refusé au technicien", async () => {
    const invoice = await newInvoice();
    const res = await pay(invoice.id, { amount: 1000, paymentDate: "2026-10-29", paymentMethod: "cash" }, "technician");
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
  });

  it.each([
    { label: "montant non numérique", body: { amount: "abc", paymentDate: "2026-10-29", paymentMethod: "cash" } },
    { label: "montant négatif", body: { amount: -5, paymentDate: "2026-10-29", paymentMethod: "cash" } },
    { label: "mode de paiement inconnu", body: { amount: 1000, paymentDate: "2026-10-29", paymentMethod: "bitcoin" } },
    { label: "corps vide", body: {} },
  ])("T3 : $label -> 400 lisible, solde intact", async ({ body }) => {
    const invoice = await newInvoice();
    const res = await pay(invoice.id, body);
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    const state = await stateOf(invoice.id);
    expect(Number(state.balance)).toBe(TOTAL);
    expect(state.payments).toHaveLength(0);
  });

  it("T7 : la même saisie rejouée renvoie le même paiement, le solde baisse une fois", async () => {
    const invoice = await newInvoice();
    const body = { amount: 50000, paymentDate: "2026-10-29", paymentMethod: "check", reference: uniqueTestToken("chq") };

    const first = await pay(invoice.id, body);
    const replay = await pay(invoice.id, body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.replayed).toBe(true);
    const state = await stateOf(invoice.id);
    expect(state.payments).toHaveLength(1);
    expect(Number(state.balance)).toBe(TOTAL - 50000);
  });

  it("T7 : un paiement au-delà du solde est refusé en 409 lisible", async () => {
    const invoice = await newInvoice();
    const res = await pay(invoice.id, { amount: TOTAL + 1, paymentDate: "2026-10-29", paymentMethod: "cash" });
    expect(res.status).toBe(409);
    expectErrorContract(res, "CONFLICT");
    expect(res.body.message).toMatch(/solde restant/);
  });
});
