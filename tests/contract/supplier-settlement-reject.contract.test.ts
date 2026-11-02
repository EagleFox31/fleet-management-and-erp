import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * SINV1 niveau C : un règlement fournisseur saisi peut être rapproché ou
 * rejeté. Avant, le statut `rejected` existait sans aucune route pour le poser :
 * une saisie erronée (mauvais montant, chèque refusé) restait déduite du reste à
 * régler pour toujours et bloquait le vrai règlement en 409.
 */

const TOTAL = 119250;
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("proof");

let server: Server;
let baseUrl = "";
let cookies: Record<"secretary" | "warehouse", string> = { secretary: "", warehouse: "" };
let secretaryId = 0;
const ids = createIdBag();

async function call(method: string, url: string, body?: unknown, as: keyof typeof cookies = "secretary") {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { Cookie: cookies[as], "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function postSettlement(invoiceId: number, amount = TOTAL) {
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("paymentMethod", "cheque");
  form.append("paymentReference", uniqueTestToken("chq"));
  form.append("paymentDate", "2026-10-29");
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements`, {
    method: "POST",
    headers: { Cookie: cookies.secretary },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const reject = (invoiceId: number, settlementId: number, body: unknown = { reason: "Chèque refusé par la banque" }, as: keyof typeof cookies = "secretary") =>
  call("PATCH", `/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reject`, body, as);

const reconcile = (invoiceId: number, settlementId: number) =>
  call("PATCH", `/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/reconcile`, {});

async function approvedInvoiceWithSettlement() {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  const recorded = await postSettlement(invoice.id);
  expect(recorded.status).toBe(201);
  return { invoice, settlement: recorded.body.settlement };
}

async function login(role: "secretary" | "warehouse") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.get("set-cookie")!.split(";")[0];
  return user;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  secretaryId = (await login("secretary")).id;
  await login("warehouse");
}, 120000);

afterAll(async () => {
  for (const name of fs.readdirSync(PROOF_DIR).filter((n) => n.startsWith(PROOF_NAME))) {
    fs.unlinkSync(path.join(PROOF_DIR, name));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("SINV1 : rejet d'un règlement fournisseur", { timeout: 120000 }, () => {
  it("rejeter un règlement saisi le libère : motif et auteur tracés, le vrai règlement passe ensuite", async () => {
    const { invoice, settlement } = await approvedInvoiceWithSettlement();
    // Avant rejet, le règlement en attente occupe tout le reste à régler.
    expect((await postSettlement(invoice.id)).status).toBe(409);

    const res = await reject(invoice.id, settlement.id);
    expect(res.status).toBe(200);
    expect(res.body.settlement).toMatchObject({
      id: settlement.id,
      status: "rejected",
      rejectionReason: "Chèque refusé par la banque",
      rejectedBy: secretaryId,
    });
    expect(res.body.settlement.rejectedAt).toBeTruthy();

    // Le solde de la facture ne bouge pas : seul un rapprochement le baisse.
    const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(Number(row.balance)).toBe(TOTAL);
    expect(row.status).toBe("approved");

    expect((await postSettlement(invoice.id)).status).toBe(201);
  });

  it("un second rejet rend le même règlement, sans réécrire motif ni date (double clic)", async () => {
    const { invoice, settlement } = await approvedInvoiceWithSettlement();
    const first = await reject(invoice.id, settlement.id);
    const second = await reject(invoice.id, settlement.id, { reason: "Autre motif" });
    expect(second.status).toBe(200);
    expect(second.body.settlement.rejectionReason).toBe("Chèque refusé par la banque");
    expect(second.body.settlement.rejectedAt).toBe(first.body.settlement.rejectedAt);
  });

  it("motif absent ou vide : 400 lisible, rien n'est rejeté", async () => {
    const { invoice, settlement } = await approvedInvoiceWithSettlement();
    for (const body of [{}, { reason: "   " }]) {
      const res = await reject(invoice.id, settlement.id, body);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/motif/i);
      expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
    }
    expect((await reconcile(invoice.id, settlement.id)).status).toBe(200);
  });

  it("un règlement rapproché ne se rejette pas (409), un règlement rejeté ne se rapproche pas (409)", async () => {
    const a = await approvedInvoiceWithSettlement();
    expect((await reconcile(a.invoice.id, a.settlement.id)).status).toBe(200);
    const late = await reject(a.invoice.id, a.settlement.id);
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/rapproché/);
    expect(JSON.stringify(late.body)).not.toMatch(/stack|SQLSTATE/);

    const b = await approvedInvoiceWithSettlement();
    expect((await reject(b.invoice.id, b.settlement.id)).status).toBe(200);
    expect((await reconcile(b.invoice.id, b.settlement.id)).status).toBe(409);
  });

  it("règlement inconnu ou d'une autre facture : 404 ; magasinier : 403", async () => {
    const a = await approvedInvoiceWithSettlement();
    const b = await approvedInvoiceWithSettlement();
    expect((await reject(a.invoice.id, b.settlement.id)).status).toBe(404);
    expect((await reject(a.invoice.id, 999999999)).status).toBe(404);
    expect((await reject(a.invoice.id, a.settlement.id, undefined, "warehouse")).status).toBe(403);
  });

  it("la liste des règlements expose le rejet", async () => {
    const { invoice, settlement } = await approvedInvoiceWithSettlement();
    await reject(invoice.id, settlement.id);
    const list = await call("GET", `/api/supplier-invoices/${invoice.id}/settlements`);
    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : list.body.settlements;
    expect(rows.find((s: any) => s.id === settlement.id)).toMatchObject({
      status: "rejected",
      rejectionReason: "Chèque refusé par la banque",
    });
  });
});
