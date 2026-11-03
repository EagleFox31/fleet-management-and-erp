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
import { leakText } from "../support/api-error";

/**
 * T7 niveau C : le formulaire de règlement d'une facture fournisseur soumis
 * deux fois (double clic, retry réseau) n'enregistre qu'un règlement, et le
 * second rapprochement bancaire ne casse rien.
 */

const TOTAL = 119250;
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
// Le nom du justificatif sert de préfixe au fichier stocké : il permet de
// compter et de supprimer les fichiers créés par ce test, et eux seuls.
const PROOF_NAME = uniqueTestToken("proof");

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

function proofFiles(): string[] {
  return fs.readdirSync(PROOF_DIR).filter((name) => name.startsWith(PROOF_NAME));
}

async function postSettlement(invoiceId: number, paymentReference: string, amount = TOTAL) {
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("paymentMethod", "virement");
  form.append("paymentReference", paymentReference);
  form.append("paymentDate", "2026-10-29");
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
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

describe("T7 : règlement fournisseur soumis deux fois", { timeout: 120000 }, () => {
  it("la seconde soumission renvoie 200 et le même règlement, sans second justificatif", async () => {
    const invoice = await approvedInvoice();
    const reference = uniqueTestToken("vir");

    const first = await postSettlement(invoice.id, reference);
    const replay = await postSettlement(invoice.id, reference);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.settlement.id).toBe(first.body.settlement.id);
    expect(replay.body.message).toMatch(/déjà enregistré/);
    // Le justificatif du rejeu est supprimé : un seul fichier reste sur disque.
    expect(proofFiles()).toHaveLength(1);
  });

  it("un second règlement qui dépasserait le total est refusé en 409 lisible", async () => {
    const invoice = await approvedInvoice();
    const before = proofFiles().length;

    expect((await postSettlement(invoice.id, uniqueTestToken("vir"))).status).toBe(201);
    const second = await postSettlement(invoice.id, uniqueTestToken("vir"));

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "CONFLICT" });
    expect(second.body.message).toMatch(/reste à régler/);
    expect(second.body.requestId).toBe(second.headers.get("x-request-id"));
    expect(leakText(second.body)).not.toMatch(/stack|SQLSTATE|violates/);
    // Le justificatif du règlement refusé ne reste pas sur disque.
    expect(proofFiles().length).toBe(before + 1);
  });

  it("deux rapprochements du même règlement répondent 200 et soldent la facture", async () => {
    const invoice = await approvedInvoice();
    const recorded = await postSettlement(invoice.id, uniqueTestToken("vir"));
    expect(recorded.status).toBe(201);

    const results = await Promise.all([
      reconcile(invoice.id, recorded.body.settlement.id),
      reconcile(invoice.id, recorded.body.settlement.id),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(row.status).toBe("paid");
    expect(Number(row.balance)).toBe(0);
  });
});
