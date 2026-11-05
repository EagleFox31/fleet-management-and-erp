import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supplierInvoiceSettlements } from "@shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Le justificatif d'un règlement fournisseur est le fichier téléversé, sous
 * `/uploads/supplier-invoices/settlements/`. À l'écriture, toute autre référence est refusée
 * (400), y compris par l'endpoint legacy `POST /:id/payment`. À la lecture, seul ce dossier
 * est servi : une ligne écrite avant cette règle avec une autre référence donne 404.
 */

const PROOF_DIR = path.join(process.cwd(), "uploads", "supplier-invoices", "settlements");
const PROOF_NAME = uniqueTestToken("proofpath");
// Dossier voisin de uploads/ dont le nom commence par « uploads » : hors périmètre.
const SIBLING_DIR = path.join(process.cwd(), `uploads-${uniqueTestToken("sibling")}`);
const SECRET = "TEST-secret-hors-uploads";
// Fichier existant d'un autre dossier de uploads/ : servi par main, hors périmètre du justificatif.
const OTHER_UPLOAD_DIR = path.join(process.cwd(), "uploads", "documents");
const OTHER_UPLOAD_NAME = `${uniqueTestToken("otherdoc")}.pdf`;
const OTHER_UPLOAD_CONTENT = "TEST-document-autre-dossier";

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();

async function api(method: string, url: string, body?: unknown) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fichier servi : le corps est le contenu brut.
  }
  return { status: response.status, body: parsed, text };
}

async function approvedInvoice() {
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status: "approved" });
  ids.invoiceIds.push(invoice.id);
  return invoice;
}

async function legacyPayment(proofReference: string) {
  const invoice = await approvedInvoice();
  const paid = await api("POST", `/api/supplier-invoices/${invoice.id}/payment`, {
    paymentDate: "2026-10-29",
    paymentMethod: "virement",
    proofReference,
  });
  const settlements = await api("GET", `/api/supplier-invoices/${invoice.id}/settlements`);
  return { paid, settlements: settlements.body as any[] };
}

/** Règlement avec justificatif téléversé ; renvoie la facture et le règlement créé. */
async function uploadedSettlement(content = "%PDF-1.4 TEST", fileName = `${PROOF_NAME}.pdf`) {
  const invoice = await approvedInvoice();
  const form = new FormData();
  form.append("amount", "1000");
  form.append("paymentMethod", "virement");
  form.append("paymentReference", uniqueTestToken("ref"));
  form.append("paymentDate", "2026-10-29");
  form.append("proofFile", new Blob([content], { type: "application/pdf" }), fileName);
  const created = await fetch(`${baseUrl}/api/supplier-invoices/${invoice.id}/settlements`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  expect(created.status).toBe(201);
  const settlements = await api("GET", `/api/supplier-invoices/${invoice.id}/settlements`);
  return { invoice, settlement: settlements.body[0] };
}

const proofOf = (invoiceId: number, settlementId: number) =>
  api("GET", `/api/supplier-invoices/${invoiceId}/settlements/${settlementId}/proof`);

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const accountant = await createTestUser({ role: "admin" });
  ids.userIds.push(accountant.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: accountant.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];

  fs.mkdirSync(SIBLING_DIR, { recursive: true });
  fs.writeFileSync(path.join(SIBLING_DIR, "secret.txt"), SECRET);
  fs.mkdirSync(OTHER_UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(OTHER_UPLOAD_DIR, OTHER_UPLOAD_NAME), OTHER_UPLOAD_CONTENT);
}, 120000);

afterAll(async () => {
  fs.rmSync(SIBLING_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(OTHER_UPLOAD_DIR, OTHER_UPLOAD_NAME), { force: true });
  if (fs.existsSync(PROOF_DIR)) {
    for (const name of fs.readdirSync(PROOF_DIR).filter((n) => n.startsWith(PROOF_NAME))) {
      fs.unlinkSync(path.join(PROOF_DIR, name));
    }
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("justificatif de règlement fournisseur : borné à son dossier", { timeout: 120000 }, () => {
  it.each([
    ["un dossier voisin dont le nom commence par « uploads »", () => `/${path.basename(SIBLING_DIR)}/secret.txt`],
    ["une remontée `..`", () => "/uploads/../package.json"],
    ["un autre dossier de uploads/", () => "/uploads/documents/carte-grise.pdf"],
    ["une remontée depuis le dossier des justificatifs", () => "/uploads/supplier-invoices/settlements/../../documents/a.pdf"],
    ["une référence libre", () => "VIR-2026-001"],
  ])("écriture legacy refusée (400) : %s, aucun règlement créé", async (_label, ref) => {
    const { paid, settlements } = await legacyPayment(ref());
    expect(paid.status).toBe(400);
    expect(paid.body.message).toBe("Justificatif de règlement invalide : téléversez une image ou un PDF.");
    expect(settlements).toEqual([]);
  });

  it("ligne déjà en base hors du dossier : 404 lisible, contenu non servi", async () => {
    const { invoice, settlement } = await uploadedSettlement();
    await db
      .update(supplierInvoiceSettlements)
      .set({ proofReference: `/${path.basename(SIBLING_DIR)}/secret.txt` })
      .where(eq(supplierInvoiceSettlements.id, settlement.id));
    const sibling = await proofOf(invoice.id, settlement.id);
    expect(sibling.status).toBe(404);
    expect(sibling.text).not.toContain(SECRET);
    expect(sibling.body.message).toBe("Justificatif introuvable");

    await db
      .update(supplierInvoiceSettlements)
      .set({ proofReference: "/uploads/../package.json" })
      .where(eq(supplierInvoiceSettlements.id, settlement.id));
    const parent = await proofOf(invoice.id, settlement.id);
    expect(parent.status).toBe(404);
    expect(parent.text).not.toContain("dependencies");
  });

  it("ligne déjà en base vers un fichier existant d'un autre dossier de uploads/ : 404 (avant : 200)", async () => {
    const { invoice, settlement } = await uploadedSettlement();
    await db
      .update(supplierInvoiceSettlements)
      .set({ proofReference: `/uploads/documents/${OTHER_UPLOAD_NAME}` })
      .where(eq(supplierInvoiceSettlements.id, settlement.id));
    const proof = await proofOf(invoice.id, settlement.id);
    expect(proof.status).toBe(404);
    expect(proof.text).not.toContain(OTHER_UPLOAD_CONTENT);
    expect(proof.body.message).toBe("Justificatif introuvable");
  });

  it.each([
    ["espace dans l'extension", "scan.p f"],
    ["espace final", "Facture.PDF "],
    ["copie numérotée", "scan.pdf(1)"],
    ["accent dans l'extension", "reçu.pdé"],
    ["extension longue", "justificatif.extensiontreslongue"],
  ])("téléversement avec un nom inhabituel (%s) : 201 puis servi (200)", async (_label, original) => {
    const { invoice, settlement } = await uploadedSettlement("%PDF-1.4 EXOTIC", `${PROOF_NAME}-${original}`);
    const proof = await proofOf(invoice.id, settlement.id);
    expect(proof.status).toBe(200);
    expect(proof.text).toBe("%PDF-1.4 EXOTIC");
  });

  it("non-régression : le justificatif téléversé est servi (200)", async () => {
    const { invoice, settlement } = await uploadedSettlement();
    const proof = await proofOf(invoice.id, settlement.id);
    expect(proof.status).toBe(200);
    expect(proof.text).toBe("%PDF-1.4 TEST");
  });

  it("non-régression : endpoint legacy avec un justificatif du dossier (200)", async () => {
    const { settlement: uploaded } = await uploadedSettlement();
    const { paid, settlements } = await legacyPayment(uploaded.proofReference);
    expect(paid.status).toBe(200);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].proofReference).toBe(uploaded.proofReference);
  });
});
