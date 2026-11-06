import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices, supplierInvoiceSettlements } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Rapprochement d'un règlement sur une facture en litige : refusé en 409, la facture reste
 * `disputed` (jamais `paid`) et le règlement reste `recorded`. Le litige posé pendant un
 * rapprochement en cours attend le verrou de la facture puis le fait échouer, sans écriture.
 */

const TOTAL = 119250;
const DISPUTED_MESSAGE = "Cette facture est en litige. Lever le litige avant de rapprocher un règlement.";
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("proof");

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

function proofFiles(): string[] {
  return fs.existsSync(PROOF_DIR) ? fs.readdirSync(PROOF_DIR).filter((name) => name.startsWith(PROOF_NAME)) : [];
}

async function postSettlement(invoiceId: number, amount = TOTAL) {
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("paymentMethod", "virement");
  form.append("paymentReference", uniqueTestToken("vir"));
  form.append("paymentDate", "2026-10-29");
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const body = await response.json().catch(() => null);
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.settlement.id as number;
}

async function reconcile(invoiceId: number, settlementId: number) {
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reconcile`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function rejectSettlement(invoiceId: number, settlementId: number) {
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reject`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Chèque refusé par la banque" }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Attend qu'une session soit bloquée sur un verrou de `supplier_invoices` (sans minuterie aveugle). */
async function waitForInvoiceLockWaiter(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%supplier_invoices%'`);
    if (Number((result.rows[0] as { n: number }).n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Le rapprochement n'a pas atteint le verrou de la facture.");
}

async function approvedInvoice() {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  return invoice;
}

async function setDisputed(invoiceId: number) {
  await db.update(supplierInvoices).set({ status: "disputed" }).where(eq(supplierInvoices.id, invoiceId));
}

async function state(invoiceId: number, settlementId: number) {
  const [invoice] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId));
  const [settlement] = await db.select().from(supplierInvoiceSettlements).where(eq(supplierInvoiceSettlements.id, settlementId));
  return {
    invoice: { status: invoice.status, balance: invoice.balance, isPaymentComplete: invoice.isPaymentComplete, paidDate: invoice.paidDate },
    settlement: { status: settlement.status, reconciledAt: settlement.reconciledAt },
  };
}

function expectDisputedConflict(r: { status: number; body: any }) {
  expect(r.status, JSON.stringify(r.body)).toBe(409);
  expect(r.body).toMatchObject({ code: "CONFLICT", message: DISPUTED_MESSAGE });
  expect(leakText(r.body)).not.toMatch(/stack|SQLSTATE|violates/);
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const accountant = await createTestUser({ role: "secretary" });
  ids.userIds.push(accountant.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: accountant.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  for (const name of proofFiles()) fs.unlinkSync(path.join(PROOF_DIR, name));
  // Les règlements partent en cascade avec les factures.
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("rapprochement sur facture en litige", { timeout: 120000 }, () => {
  it("témoin : facture approuvée, le rapprochement du règlement complet la solde", async () => {
    const invoice = await approvedInvoice();
    const settlementId = await postSettlement(invoice.id);
    const r = await reconcile(invoice.id, settlementId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await state(invoice.id, settlementId)).invoice).toMatchObject({ status: "paid", isPaymentComplete: true });
  });

  it("litige posé avant le rapprochement : 409 lisible, ni la facture ni le règlement ne bougent", async () => {
    const invoice = await approvedInvoice();
    const settlementId = await postSettlement(invoice.id);
    await setDisputed(invoice.id);
    const before = await state(invoice.id, settlementId);

    expectDisputedConflict(await reconcile(invoice.id, settlementId));

    const after = await state(invoice.id, settlementId);
    expect(after).toEqual(before);
    expect(after.invoice.status).toBe("disputed");
    expect(after.settlement.status).toBe("recorded");
  });

  it("rejeu d'un rapprochement après mise en litige : 409, la facture reste en litige", async () => {
    const invoice = await approvedInvoice();
    const settlementId = await postSettlement(invoice.id, TOTAL / 2);
    expect((await reconcile(invoice.id, settlementId)).status).toBe(200);
    await setDisputed(invoice.id);
    const before = await state(invoice.id, settlementId);

    expectDisputedConflict(await reconcile(invoice.id, settlementId));

    expect(await state(invoice.id, settlementId)).toEqual(before);
  });

  it("litige posé pendant le rapprochement : le rapprochement attend le verrou puis échoue sans écrire", async () => {
    const invoice = await approvedInvoice();
    const settlementId = await postSettlement(invoice.id);

    let pending: Promise<{ status: number; body: any }> | undefined;
    await db.transaction(async (tx) => {
      await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id)).for("update");
      pending = reconcile(invoice.id, settlementId);
      // Le litige n'est posé qu'une fois le rapprochement bloqué sur le verrou de la facture.
      await waitForInvoiceLockWaiter();
      await tx.update(supplierInvoices).set({ status: "disputed" }).where(eq(supplierInvoices.id, invoice.id));
    });

    expectDisputedConflict(await pending!);
    const after = await state(invoice.id, settlementId);
    expect(after.invoice.status).toBe("disputed");
    expect(after.invoice.isPaymentComplete).not.toBe(true);
    expect(after.settlement).toEqual({ status: "recorded", reconciledAt: null });
  });
});

describe("rejet et rapprochement simultanés du même règlement", { timeout: 120000 }, () => {
  // Les deux transactions verrouillent la facture puis le règlement : l'une attend l'autre,
  // jamais d'interblocage (40P01, qui ressortirait en 409 générique « Référence »).
  const BUSINESS_409 = [
    "Un règlement rapproché ne peut pas être rejeté.",
    "Un règlement rejeté ne peut pas être rapproché.",
    "Ce règlement a été modifié entre-temps. Rechargez la page puis réessayez.",
  ];

  it.each([1, 2, 3, 4, 5])("essai %i : un 200 et un 409 métier, état final cohérent", async () => {
    const invoice = await approvedInvoice();
    const settlementId = await postSettlement(invoice.id);

    const [rec, rej] = await Promise.all([reconcile(invoice.id, settlementId), rejectSettlement(invoice.id, settlementId)]);

    expect([rec.status, rej.status].sort(), JSON.stringify({ rec: rec.body, rej: rej.body })).toEqual([200, 409]);
    const conflict = rec.status === 409 ? rec : rej;
    expect(BUSINESS_409, JSON.stringify(conflict.body)).toContain(conflict.body.message);
    const after = await state(invoice.id, settlementId);
    if (rec.status === 200) {
      expect(after).toMatchObject({ invoice: { status: "paid" }, settlement: { status: "reconciled" } });
    } else {
      expect(after).toMatchObject({ invoice: { status: "approved", isPaymentComplete: false }, settlement: { status: "rejected" } });
    }
  });
});
