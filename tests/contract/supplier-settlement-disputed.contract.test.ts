import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
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
      // Laisse la requête atteindre le verrou de la facture avant de poser le litige.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await tx.update(supplierInvoices).set({ status: "disputed" }).where(eq(supplierInvoices.id, invoice.id));
    });

    expectDisputedConflict(await pending!);
    const after = await state(invoice.id, settlementId);
    expect(after.invoice.status).toBe("disputed");
    expect(after.invoice.isPaymentComplete).not.toBe(true);
    expect(after.settlement).toEqual({ status: "recorded", reconciledAt: null });
  });
});
