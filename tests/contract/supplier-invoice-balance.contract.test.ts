import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * R-09 niveau C : une facture fournisseur créée par l'écran naît avec un solde égal
 * au total TTC (et non "0.00"), le règlement partiel puis total fonctionne, le
 * trop-perçu est refusé en 409 et un numéro en doublon aussi.
 */

const HT = 100000;
const TTC = 119250;
const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("proof");

let server: Server;
let baseUrl = "";
let cookie = "";
let supplierId = 0;
const ids = createIdBag();

function proofFiles(): string[] {
  return fs.existsSync(PROOF_DIR) ? fs.readdirSync(PROOF_DIR).filter((name) => name.startsWith(PROOF_NAME)) : [];
}

async function json(method: string, url: string, body?: unknown) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

/** Corps de l'écran `procurement/invoices/new` : aucun champ `balance`. */
function screenPayload(extra: Record<string, unknown> = {}) {
  return {
    supplierId,
    invoiceNumber: uniqueTestToken("inv"),
    invoiceDate: "2026-10-30",
    family: "TEST",
    description: "Facture de recette",
    amountHT: String(HT),
    vatAmount: String(TTC - HT),
    totalTTC: String(TTC),
    ...extra,
  };
}

async function createInvoice(extra: Record<string, unknown> = {}) {
  const res = await json("POST", "/api/supplier-invoices", screenPayload(extra));
  if (res.status === 201) ids.invoiceIds.push(res.body.invoice.id);
  return res;
}

async function approvedInvoice() {
  const created = await createInvoice();
  expect(created.status).toBe(201);
  const id = created.body.invoice.id as number;
  expect((await json("PATCH", `/api/supplier-invoices/${id}/approve`, {})).status).toBe(200);
  return id;
}

async function settle(invoiceId: number, amount: number) {
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("paymentMethod", "virement");
  form.append("paymentReference", uniqueTestToken("vir"));
  form.append("paymentDate", "2026-10-30");
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${PROOF_NAME}.pdf`);
  const response = await fetch(`${baseUrl}/api/supplier-invoices/${invoiceId}/settlements`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function balanceOf(invoiceId: number) {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId));
  return { balance: Number(row.balance), status: row.status };
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

  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120000);

afterAll(async () => {
  for (const name of proofFiles()) fs.unlinkSync(path.join(PROOF_DIR, name));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("R-09 : solde d'une facture fournisseur", { timeout: 120000 }, () => {
  it("la création sans balance initialise le solde au total TTC", async () => {
    const res = await createInvoice();
    expect(res.status).toBe(201);
    expect(Number(res.body.invoice.balance)).toBe(TTC);
    expect(await balanceOf(res.body.invoice.id)).toMatchObject({ balance: TTC, status: "received" });
  });

  it("un solde fourni par le client est ignoré", async () => {
    const res = await createInvoice({ balance: "5.00" });
    expect(res.status).toBe(201);
    expect(Number(res.body.invoice.balance)).toBe(TTC);
  });

  it("règlement partiel puis total : le solde baisse au rapprochement et la facture est soldée", async () => {
    const id = await approvedInvoice();

    const first = await settle(id, 50000);
    expect(first.status).toBe(201);
    expect((await json("PATCH", `/api/supplier-invoices/${id}/settlements/${first.body.settlement.id}/reconcile`, {})).status).toBe(200);
    expect(await balanceOf(id)).toMatchObject({ balance: TTC - 50000, status: "approved" });

    const second = await settle(id, TTC - 50000);
    expect(second.status).toBe(201);
    expect((await json("PATCH", `/api/supplier-invoices/${id}/settlements/${second.body.settlement.id}/reconcile`, {})).status).toBe(200);
    expect(await balanceOf(id)).toMatchObject({ balance: 0, status: "paid" });
  });

  it("un trop-perçu est refusé en 409 lisible, le solde reste entier", async () => {
    const id = await approvedInvoice();
    const res = await settle(id, TTC + 1);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "CONFLICT" });
    expect(res.body.message).toMatch(/supérieur au solde restant \(119250\.00 FCFA\)/);
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
    expect((await balanceOf(id)).balance).toBe(TTC);
  });

  it("un numéro de facture en doublon répond 409 lisible, sans détail technique", async () => {
    const invoiceNumber = uniqueTestToken("dup");
    expect((await createInvoice({ invoiceNumber })).status).toBe(201);

    const duplicate = await createInvoice({ invoiceNumber });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: "CONFLICT" });
    expect(duplicate.body.message).toContain(invoiceNumber);
    expect(duplicate.body.requestId).toBe(duplicate.headers.get("x-request-id"));
    expect(JSON.stringify(duplicate.body)).not.toMatch(/stack|SQLSTATE|violates|duplicate key|constraint/i);
  });
});
